/**
 * Runnable grading-config demo (DEV-ONLY). Exercises the Phase 8 write-side
 * use-cases against the seeded dev.db: create a valid grade scale, reject an
 * invalid one (write-side validation), set it default, list. Cleans up.
 * Run: npm run db:seed && npm run demo:config
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaGradeScaleRepository } from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  CreateGradeScale,
  SetDefaultGradeScale,
  DeleteGradeScale,
  ListGradeScales,
} from "../src/application/use-cases/config/ManageGradeScales";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const scales = new PrismaGradeScaleRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "config.read",
    "config.manage",
  ]);

  console.log("1) Create a valid grade scale:");
  const created = await new CreateGradeScale(scales, audit).execute(
    {
      name: "Demo Honours",
      bands: [
        { minMark: 0, maxMark: 39, grade: "F", gradePoint: 0, isPass: false },
        { minMark: 40, maxMark: 100, grade: "P", gradePoint: 4, isPass: true },
      ],
    },
    admin,
  );
  console.log(`   ✓ created "${created.name}"`);

  console.log("2) Reject an invalid scale (gap in coverage):");
  try {
    await new CreateGradeScale(scales, audit).execute(
      {
        name: "Demo Bad",
        bands: [
          { minMark: 0, maxMark: 30, grade: "F", gradePoint: 0, isPass: false },
          {
            minMark: 50,
            maxMark: 100,
            grade: "P",
            gradePoint: 4,
            isPass: true,
          },
        ],
      },
      admin,
    );
    console.log("   ✗ invalid scale was saved (BAD)");
  } catch (e) {
    console.log(`   ✓ rejected as ${(e as Error).name}`);
  }

  console.log("3) Set it as default:");
  await new SetDefaultGradeScale(scales, audit).execute(
    { id: created.id },
    admin,
  );
  const def = await scales.findDefault();
  console.log(`   default scale = ${def?.name}`);

  console.log("4) Cannot delete the default:");
  try {
    await new DeleteGradeScale(scales, audit).execute(
      { id: created.id },
      admin,
    );
    console.log("   ✗ default deleted (BAD)");
  } catch {
    console.log("   ✓ delete-default rejected");
  }

  console.log("5) List scales:");
  for (const s of await new ListGradeScales(scales).execute({}, admin)) {
    console.log(`   - ${s.name}${s.isDefault ? " (default)" : ""}`);
  }

  console.log("6) Cleanup:");
  // Restore the seeded default, then remove the demo scale.
  const seeded = await scales.findByName("Default 5-Point Scale");
  if (seeded) await scales.setDefault(seeded.id);
  await db.gradeScale.deleteMany({ where: { name: { startsWith: "Demo " } } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
