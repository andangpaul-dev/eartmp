/**
 * Runnable end-to-end login demo (DEV-ONLY).
 *
 * Wires the Phase 2 auth use-cases to the Prisma dev repositories (ADR-007: a
 * temporary adapter replaced by the Tauri-SQL data layer in Phase 7) and the
 * real Argon2id hasher, against the seeded `dev.db`. Demonstrates: a successful
 * login, a rejected wrong password, and the fail-closed authorization seam
 * denying a privileged action to an under-privileged session.
 *
 * Run: npm run db:seed && npm run demo:login
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaUserRepository,
  PrismaRoleRepository,
  PrismaAuditLogAdapter,
} from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { Argon2HashingService } from "../src/infrastructure/crypto/Argon2HashingService";
import { AuthenticateUser } from "../src/application/use-cases/auth/AuthenticateUser";
import { CreateUser } from "../src/application/use-cases/auth/ManageUsers";
import { authorize } from "../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ClockPort } from "../src/application/ports/ClockPort";

const systemClock: ClockPort = { now: () => new Date() };

async function main(): Promise<void> {
  const db = getPrisma();
  const users = new PrismaUserRepository(db);
  const roles = new PrismaRoleRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const login = new AuthenticateUser(
    users,
    roles,
    new Argon2HashingService(),
    audit,
    systemClock,
  );

  console.log("1) Correct login:");
  const session = await authorize(
    login,
    { username: "admin", password: "ChangeMe123!" },
    null,
  );
  console.log(
    `   ✓ ${session.roleName} (actor ${session.actorId}) with ${session.permissionList().length} permissions`,
  );

  console.log("2) Wrong password:");
  try {
    await authorize(login, { username: "admin", password: "WRONG" }, null);
    console.log("   ✗ unexpectedly succeeded");
  } catch (e) {
    console.log(
      `   ✓ rejected as ${(e as Error).name}: ${(e as Error).message}`,
    );
  }

  console.log("3) Fail-closed authorization (VIEWER tries CreateUser):");
  const viewer = SessionContext.create("viewer-1", "VIEWER", ["students.read"]);
  const createUser = new CreateUser(users, new Argon2HashingService(), audit);
  try {
    await authorize(
      createUser,
      {
        username: "mallory",
        email: "m@e.edu",
        fullName: "Mallory",
        roleId: "x",
        password: "p",
      },
      viewer,
    );
    console.log("   ✗ unexpectedly allowed");
  } catch (e) {
    console.log(`   ✓ denied as ${(e as Error).name}`);
  }

  const loginCount = await db.auditLog.count({ where: { action: "LOGIN" } });
  console.log(`4) Audit: ${loginCount} LOGIN entry(ies) recorded.`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
