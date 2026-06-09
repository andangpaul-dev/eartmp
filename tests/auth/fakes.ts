/**
 * In-memory fakes for the auth tests. These let the whole auth layer run with
 * no database and no UI — the same architecture proof used in Phase 1. The
 * fake hasher is deterministic (no real Argon2) so unit tests stay fast.
 */
import type { UserAccount, Role } from "../../src/domain/entities/auth";
import type {
  UserRepository,
  RoleRepository,
} from "../../src/domain/repositories/auth";
import type { AuditLogPort } from "../../src/domain/repositories";
import type { HashingPort } from "../../src/application/ports/HashingPort";
import type { ClockPort } from "../../src/application/ports/ClockPort";

export class FakeHasher implements HashingPort {
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

export class FixedClock implements ClockPort {
  constructor(private readonly fixed = new Date("2026-01-01T00:00:00.000Z")) {}
  now(): Date {
    return this.fixed;
  }
}

export interface AuditEntry {
  userId?: string;
  action: string;
  entity: string;
  recordId?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export class CapturingAudit implements AuditLogPort {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class InMemoryUserRepository implements UserRepository {
  private seq = 0;
  readonly byId = new Map<string, UserAccount>();

  constructor(seedUsers: UserAccount[] = []) {
    for (const u of seedUsers) this.byId.set(u.id, { ...u });
  }

  async findById(id: string): Promise<UserAccount | null> {
    return this.byId.get(id) ?? null;
  }
  async findByUsername(username: string): Promise<UserAccount | null> {
    for (const u of this.byId.values()) {
      if (u.username === username) return u;
    }
    return null;
  }
  async create(
    data: Omit<UserAccount, "id" | "lastLoginAt"> & { lastLoginAt?: Date },
  ): Promise<UserAccount> {
    const user: UserAccount = { id: `u${++this.seq}`, ...data };
    this.byId.set(user.id, user);
    return { ...user };
  }
  async update(id: string, patch: Partial<UserAccount>): Promise<UserAccount> {
    const current = this.byId.get(id);
    if (!current) throw new Error(`No user ${id}`);
    const updated = { ...current, ...patch };
    this.byId.set(id, updated);
    return { ...updated };
  }
}

export class InMemoryRoleRepository implements RoleRepository {
  readonly byId = new Map<string, Role>();
  constructor(roles: Role[] = []) {
    for (const r of roles) this.byId.set(r.id, r);
  }
  async findById(id: string): Promise<Role | null> {
    return this.byId.get(id) ?? null;
  }
  async findByName(name: string): Promise<Role | null> {
    for (const r of this.byId.values()) {
      if (r.name === name) return r;
    }
    return null;
  }
}

export const adminRole: Role = {
  id: "role-admin",
  name: "SUPER_ADMIN",
  permissions: [
    { id: "p1", key: "users.create", label: "Create users" },
    { id: "p2", key: "users.update", label: "Edit users" },
    { id: "p3", key: "roles.assign", label: "Assign roles" },
  ],
};

export const viewerRole: Role = {
  id: "role-viewer",
  name: "VIEWER",
  permissions: [{ id: "p9", key: "students.read", label: "View students" }],
};
