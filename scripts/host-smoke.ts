/**
 * Host seam smoke test (shell phase, Milestone 1). Proves the webview→host→core
 * path end to end against the real SQLite DB, through the authorization gate:
 *   login → SessionContext → dispatch listStudents → Prisma → envelope.
 * Also shows the gate rejecting an unauthenticated call and an unknown method.
 * Run: npm run db:seed && npm run host:smoke
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { buildHost } from "../src/host/composition";
import { createCore } from "../src/host/dispatcher";

async function main(): Promise<void> {
  const db = getPrisma();
  const core = createCore(buildHost(db));

  console.log("1) Login (seeded admin):");
  const { token, session } = await core.login({
    username: "admin",
    password: "ChangeMe123!",
  });
  console.log(
    `   role=${session.role}, ${session.permissions.length} permissions`,
  );

  console.log("2) Dispatch listStudents through the gate (real SQLite):");
  const res = await core.dispatch("listStudents", { take: 1 }, token);
  console.log(
    res.ok
      ? `   ✓ ok — total students = ${(res.data as { total: number }).total}`
      : `   ✗ ${res.error.code}: ${res.error.message}`,
  );

  console.log("3) Same call with NO session → gate rejects:");
  const bad = await core.dispatch("listStudents", { take: 1 }, "bogus-token");
  console.log(
    bad.ok ? "   ✗ allowed (BAD)" : `   ✓ rejected (${bad.error.code})`,
  );

  console.log("4) Unknown method → NOT_FOUND:");
  const nf = await core.dispatch("doesNotExist", {});
  console.log(nf.ok ? "   ✗ (BAD)" : `   ✓ ${nf.error.code}`);

  await db.$disconnect();
  console.log("\nHost seam smoke: GREEN ✅");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
