/**
 * Prisma-backed auth repositories — DEV-ONLY adapter.
 *
 * Per ADR-007 the production runtime data layer is the Tauri SQL plugin (Rust),
 * not @prisma/client. These implementations exist so login/admin flows can be
 * demonstrated end-to-end before the Tauri shell exists; they are replaced in
 * Phase 7. They are the only place that knows about Prisma; the domain depends
 * only on the ports.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import type { UserAccount, Role, Permission } from "../../domain/entities/auth";
import type {
  UserRepository,
  RoleRepository,
  PermissionRepository,
} from "../../domain/repositories/auth";
import type { AuditLogPort } from "../../domain/repositories";

type PrismaUserRow = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
  roleId: string;
  isActive: boolean;
  lastLoginAt: Date | null;
};

function toUser(row: PrismaUserRow): UserAccount {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    roleId: row.roleId,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt ?? undefined,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<UserAccount | null> {
    const row = await this.db.user.findFirst({
      where: { id, deletedAt: null },
    });
    return row ? toUser(row) : null;
  }

  async findByUsername(username: string): Promise<UserAccount | null> {
    const row = await this.db.user.findFirst({
      where: { username, deletedAt: null },
    });
    return row ? toUser(row) : null;
  }

  async create(
    data: Omit<UserAccount, "id" | "lastLoginAt"> & { lastLoginAt?: Date },
  ): Promise<UserAccount> {
    const row = await this.db.user.create({
      data: {
        username: data.username,
        email: data.email,
        fullName: data.fullName,
        passwordHash: data.passwordHash,
        roleId: data.roleId,
        isActive: data.isActive,
      },
    });
    return toUser(row);
  }

  async update(id: string, patch: Partial<UserAccount>): Promise<UserAccount> {
    const row = await this.db.user.update({
      where: { id },
      data: {
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.passwordHash !== undefined
          ? { passwordHash: patch.passwordHash }
          : {}),
        ...(patch.roleId !== undefined ? { roleId: patch.roleId } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(patch.lastLoginAt !== undefined
          ? { lastLoginAt: patch.lastLoginAt }
          : {}),
      },
    });
    return toUser(row);
  }
}

type PrismaRoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: { permission: { id: string; key: string; label: string } }[];
};

function toRole(row: PrismaRoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    permissions: row.permissions.map((rp) => rp.permission),
  };
}

const roleInclude = { permissions: { include: { permission: true } } } as const;

export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<Role | null> {
    const row = await this.db.role.findFirst({
      where: { id, deletedAt: null },
      include: roleInclude,
    });
    return row ? toRole(row) : null;
  }

  async findByName(name: string): Promise<Role | null> {
    const row = await this.db.role.findFirst({
      where: { name, deletedAt: null },
      include: roleInclude,
    });
    return row ? toRole(row) : null;
  }
}

export class PrismaPermissionRepository implements PermissionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByKey(key: string): Promise<Permission | null> {
    const row = await this.db.permission.findFirst({
      where: { key, deletedAt: null },
    });
    return row ? { id: row.id, key: row.key, label: row.label } : null;
  }

  async findAll(): Promise<Permission[]> {
    const rows = await this.db.permission.findMany({
      where: { deletedAt: null },
    });
    return rows.map((r) => ({ id: r.id, key: r.key, label: r.label }));
  }
}

/**
 * Append-only audit adapter (Prisma dev impl). Accepts a
 * `Prisma.TransactionClient` so it can run inside a UnitOfWork transaction (a
 * full PrismaClient is also assignable).
 */
export class PrismaAuditLogAdapter implements AuditLogPort {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async record(entry: {
    userId?: string;
    action: string;
    entity: string;
    recordId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        recordId: entry.recordId ?? null,
        oldValue:
          entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
        newValue:
          entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      },
    });
  }
}
