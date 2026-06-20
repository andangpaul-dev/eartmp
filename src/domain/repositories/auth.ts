/**
 * Auth repository ports. The application depends on these interfaces;
 * infrastructure provides the concrete (Prisma dev / Tauri-SQL runtime)
 * implementations.
 */
import type { UserAccount, Role, Permission } from "../entities/auth";

export interface UserRepository {
  findById(id: string): Promise<UserAccount | null>;
  findByUsername(username: string): Promise<UserAccount | null>;
  /** All live (non-deleted) users, newest first. */
  list(): Promise<UserAccount[]>;
  create(
    data: Omit<UserAccount, "id" | "lastLoginAt"> & { lastLoginAt?: Date },
  ): Promise<UserAccount>;
  update(id: string, patch: Partial<UserAccount>): Promise<UserAccount>;
  /** A user's assigned faculties (empty = institution-wide / unscoped). */
  facultyIds(userId: string): Promise<string[]>;
  /** All users' faculty assignments at once (userId → facultyIds), for lists. */
  facultyIdsByUser(): Promise<Record<string, string[]>>;
  /** Replace a user's faculty assignments with exactly this set. */
  setFaculties(userId: string, facultyIds: string[]): Promise<void>;
}

export interface RoleRepository {
  /** Returns the role with its permissions hydrated, or null. */
  findById(id: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
  /** All roles with permissions hydrated. */
  list(): Promise<Role[]>;
  create(data: { name: string; description?: string }): Promise<Role>;
  update(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<Role>;
  softDelete(id: string): Promise<void>;
  /** Replace the role's permission set with the given permission keys. */
  setPermissions(roleId: string, permissionKeys: string[]): Promise<Role>;
  /** Count live users currently assigned this role (guards deletion). */
  countUsers(roleId: string): Promise<number>;
}

export interface PermissionRepository {
  findByKey(key: string): Promise<Permission | null>;
  findAll(): Promise<Permission[]>;
}
