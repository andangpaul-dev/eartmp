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
import {
  canonicalAuditPayload,
  type AuditEntry,
} from "../../domain/services/AuditChain";
import type {
  AuditLogQueryRepository,
  AuditQuery,
} from "../../domain/repositories/audit";
import type { Page } from "../../domain/repositories/records";
import type { AuditHasher } from "../../application/ports/AuditHasher";
import { Sha256Hasher } from "../crypto/Sha256Hasher";
import type { AuditLogPort } from "../../domain/repositories";

type PrismaUserRow = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  passwordHash: string;
  roleId: string;
  institutionId: string | null;
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
    ...(row.institutionId ? { institutionId: row.institutionId } : {}),
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

  async list(): Promise<UserAccount[]> {
    const rows = await this.db.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toUser);
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
        institutionId: data.institutionId ?? null,
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
        ...(patch.institutionId !== undefined
          ? { institutionId: patch.institutionId }
          : {}),
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

  async list(): Promise<Role[]> {
    const rows = await this.db.role.findMany({
      where: { deletedAt: null },
      include: roleInclude,
      orderBy: { name: "asc" },
    });
    return rows.map(toRole);
  }

  async create(data: { name: string; description?: string }): Promise<Role> {
    const row = await this.db.role.create({
      data: { name: data.name, description: data.description ?? null },
      include: roleInclude,
    });
    return toRole(row);
  }

  async update(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<Role> {
    const row = await this.db.role.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
      },
      include: roleInclude,
    });
    return toRole(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async setPermissions(
    roleId: string,
    permissionKeys: string[],
  ): Promise<Role> {
    const perms = await this.db.permission.findMany({
      where: { key: { in: permissionKeys }, deletedAt: null },
      select: { id: true },
    });
    await this.db.$transaction([
      this.db.rolePermission.deleteMany({ where: { roleId } }),
      this.db.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      }),
    ]);
    const row = await this.db.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: roleInclude,
    });
    return toRole(row!);
  }

  async countUsers(roleId: string): Promise<number> {
    return this.db.user.count({ where: { roleId, deletedAt: null } });
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
  constructor(
    private readonly db: Prisma.TransactionClient,
    private readonly hasher: AuditHasher = new Sha256Hasher(),
  ) {}

  async record(entry: {
    userId?: string;
    action: string;
    entity: string;
    recordId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }): Promise<void> {
    const oldValue =
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null;
    const newValue =
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null;
    const createdAt = new Date();

    // Chain onto the latest entry (Phase 19): prevHash = its hash (or null).
    const last = await this.db.auditLog.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { hash: true },
    });
    const prevHash = last?.hash ?? null;
    const payload = canonicalAuditPayload({
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      recordId: entry.recordId,
      oldValue: oldValue ?? undefined,
      newValue: newValue ?? undefined,
      createdAt: createdAt.toISOString(),
    });
    const hash = this.hasher.hash((prevHash ?? "") + payload);

    await this.db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        recordId: entry.recordId ?? null,
        oldValue,
        newValue,
        createdAt,
        prevHash,
        hash,
      },
    });
  }
}

type AuditRow = {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  recordId: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  prevHash: string | null;
  hash: string | null;
};

function toAuditEntry(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    userId: r.userId ?? undefined,
    action: r.action,
    entity: r.entity,
    recordId: r.recordId ?? undefined,
    oldValue: r.oldValue ?? undefined,
    newValue: r.newValue ?? undefined,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash ?? undefined,
    hash: r.hash ?? undefined,
  };
}

export class PrismaAuditLogQueryRepository implements AuditLogQueryRepository {
  constructor(private readonly db: PrismaClient) {}

  async find(query: AuditQuery): Promise<Page<AuditEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { userId: query.actorId } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return { items: rows.map(toAuditEntry), total };
  }

  async listOrdered(): Promise<AuditEntry[]> {
    const rows = await this.db.auditLog.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toAuditEntry);
  }
}
