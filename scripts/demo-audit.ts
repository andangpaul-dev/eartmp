/**
 * Runnable audit demo (DEV-ONLY). Writes a few chained audit entries, queries
 * with a filter, verifies the chain (clean), tampers with one row to show the
 * verifier pinpoints the first broken link, then cleans up the demo entries.
 * Run: npm run db:seed && npm run demo:audit
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaAuditLogAdapter,
  PrismaAuditLogQueryRepository,
} from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { Sha256Hasher } from "../src/infrastructure/crypto/Sha256Hasher";
import {
  GetAuditLog,
  VerifyAuditChain,
} from "../src/application/use-cases/audit/AuditQueries";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const adapter = new PrismaAuditLogAdapter(db);
  const repo = new PrismaAuditLogQueryRepository(db);
  const verify = new VerifyAuditChain(repo, new Sha256Hasher());
  const getLog = new GetAuditLog(repo);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", ["audit.read"]);

  console.log("1) Write chained audit entries:");
  for (const action of ["CREATE", "UPDATE", "APPROVE", "EXPORT"]) {
    await adapter.record({
      userId: "demo-user",
      action,
      entity: "DemoAudit",
      recordId: `rec-${action}`,
      newValue: { action },
    });
  }
  console.log("   wrote 4 entries (entity=DemoAudit)");

  console.log("2) Query (filter entity=DemoAudit, action=EXPORT):");
  const page = await getLog.execute(
    { entity: "DemoAudit", action: "EXPORT" },
    admin,
  );
  console.log(`   ${page.total} match; first action=${page.items[0]?.action}`);

  console.log("3) Verify the chain (clean):");
  const v1 = await verify.execute({}, admin);
  console.log(`   valid=${v1.valid}, checked=${v1.checked}`);

  console.log("4) Tamper with one entry → verify pinpoints it:");
  const target = await db.auditLog.findFirst({
    where: { entity: "DemoAudit", action: "UPDATE" },
  });
  await db.auditLog.update({
    where: { id: target!.id },
    data: { newValue: JSON.stringify({ action: "TAMPERED" }) },
  });
  const v2 = await verify.execute({}, admin);
  console.log(
    `   valid=${v2.valid}; brokenAt index=${v2.brokenAt?.index} reason=${v2.brokenAt?.reason}`,
  );

  console.log("5) Cleanup:");
  await db.auditLog.deleteMany({ where: { entity: "DemoAudit" } });
  console.log("   ✓ cleaned up demo entries");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
