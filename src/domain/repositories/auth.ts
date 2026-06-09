/**
 * Auth repository ports. The application depends on these interfaces;
 * infrastructure provides the concrete (Prisma dev / Tauri-SQL runtime)
 * implementations.
 */
import type { UserAccount, Role, Permission } from "../entities/auth";

export interface UserRepository {
  findById(id: string): Promise<UserAccount | null>;
  findByUsername(username: string): Promise<UserAccount | null>;
  create(
    data: Omit<UserAccount, "id" | "lastLoginAt"> & { lastLoginAt?: Date },
  ): Promise<UserAccount>;
  update(id: string, patch: Partial<UserAccount>): Promise<UserAccount>;
}

export interface RoleRepository {
  /** Returns the role with its permissions hydrated, or null. */
  findById(id: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
}

export interface PermissionRepository {
  findByKey(key: string): Promise<Permission | null>;
  findAll(): Promise<Permission[]>;
}
