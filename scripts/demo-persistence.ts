/**
 * Runnable persistence demo (DEV-ONLY). Shows the Phase 7 foundation against the
 * seeded dev.db: a UnitOfWork commit, an atomic rollback (F-1), and an
 * optimistic-locking version conflict (F-27). Cleans up after itself.
 * Run: npm run db:seed && npm run demo:persistence
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaUnitOfWork } from "../src/infrastructure/persistence/PrismaUnitOfWork";
import { PrismaStudentRepository } from "../src/infrastructure/repositories/PrismaRecordsRepositories";

async function main(): Promise<void> {
  const db = getPrisma();
  const uow = new PrismaUnitOfWork(db);
  const repo = new PrismaStudentRepository(db);

  console.log("1) UnitOfWork commit:");
  await uow.run(async (repos) => {
    await repos.students.create({
      matricNumber: "DPERS/OK",
      fullName: "Committed",
      status: "ACTIVE",
    });
  });
  console.log(
    `   student persisted: ${(await repo.findByMatric("DPERS/OK")) !== null}`,
  );

  console.log("2) UnitOfWork rollback (F-1):");
  try {
    await uow.run(async (repos) => {
      await repos.students.create({
        matricNumber: "DPERS/RB",
        fullName: "RolledBack",
        status: "ACTIVE",
      });
      throw new Error("forced failure after the write");
    });
  } catch {
    /* expected */
  }
  console.log(
    `   rolled back (no DPERS/RB row): ${(await repo.findByMatric("DPERS/RB")) === null}`,
  );

  console.log("3) Optimistic locking (F-27):");
  const s = (await repo.findByMatric("DPERS/OK"))!;
  const v0 = await repo.readVersion(s.id);
  const v1 = await repo.tryUpdate(s.id, { status: "DEFERRED" }, v0!);
  console.log(`   updated v${v0} → v${v1}`);
  try {
    await repo.tryUpdate(s.id, { status: "ACTIVE" }, v0!); // stale
    console.log("   ✗ stale write allowed (BAD)");
  } catch (e) {
    console.log(`   ✓ stale write rejected as ${(e as Error).name}`);
  }

  console.log("4) Cleanup:");
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: "DPERS/" } },
  });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
