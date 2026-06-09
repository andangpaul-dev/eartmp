/**
 * Auth domain entities — framework-free types and invariants for users, roles
 * and permissions. No Prisma, no React, no I/O.
 */

export interface Permission {
  id: string;
  key: string; // e.g. "students.create"
  label: string;
}

export interface Role {
  id: string;
  name: string; // e.g. "SUPER_ADMIN"
  description?: string;
  permissions: Permission[];
}

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  passwordHash: string; // Argon2id — never plaintext
  roleId: string;
  isActive: boolean;
  lastLoginAt?: Date;
}

/** Invariants kept with the entities. */
export const UserRules = {
  /** A user may authenticate only if active and tied to a role. */
  canAuthenticate(user: Pick<UserAccount, "isActive" | "roleId">): boolean {
    return user.isActive && user.roleId.length > 0;
  },
};

/** Effective permission keys a role grants. */
export function rolePermissionKeys(role: Role): string[] {
  return role.permissions.map((p) => p.key);
}
