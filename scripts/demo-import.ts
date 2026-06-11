/**
 * Runnable spreadsheet-import demo (DEV-ONLY). Builds an in-memory .xlsx,
 * parses it with the SheetJS reader, then runs ImportResults against the seeded
 * dev.db: a clean import, a batch with an error (report, nothing written), and a
 * dry run. Builds prerequisites and cleans up.
 * Run: npm run db:seed && npm run demo:import
 */
import * as XLSX from "xlsx";
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaStudentRepository,
  PrismaCourseRepository,
  PrismaResultRepository,
} from "../src/infrastructure/repositories/PrismaRecordsRepositories";
import {
  PrismaGradeScaleRepository,
  PrismaAssessmentConfigRepository,
} from "../src/infrastructure/repositories/PrismaGradingRepositories";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { SheetJsReader } from "../src/infrastructure/import/SheetJsReader";
import { PrismaUnitOfWork } from "../src/infrastructure/persistence/PrismaUnitOfWork";
import { GradingConfigService } from "../src/application/services/GradingConfigService";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { ImportResults } from "../src/application/use-cases/results/ImportResults";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { RawRow } from "../src/application/ports/SpreadsheetReaderPort";

function toXlsx(rows: RawRow[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

async function main(): Promise<void> {
  const db = getPrisma();
  const reader = new SheetJsReader();
  const grading = new GradingConfigService(
    new PrismaGradeScaleRepository(db),
    new PrismaAssessmentConfigRepository(db),
    new PrismaSettingRepository(db),
    buildDefaultRegistry(),
  );
  const importResults = new ImportResults(
    new PrismaStudentRepository(db),
    new PrismaCourseRepository(db),
    new PrismaResultRepository(db),
    grading,
    new PrismaUnitOfWork(db),
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "results.import",
  ]);

  // Prerequisites.
  const fac = await db.faculty.create({
    data: { name: "DImpSci", code: "DIMP" },
  });
  const dep = await db.department.create({
    data: { name: "CS", code: "DIMPCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DIMPB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: "DIMP 24/25" },
  });
  const sem = await db.semester.create({
    data: { name: "First", rank: 1, sessionId: sess.id },
  });
  for (const m of ["DIMP/0001", "DIMP/0002"]) {
    await db.student.create({
      data: {
        matricNumber: m,
        fullName: m,
        programmeId: prog.id,
        levelId: lvl.id,
      },
    });
  }
  await db.course.create({
    data: {
      code: "DIMPCS101",
      title: "Intro",
      creditValue: 3,
      programmeId: prog.id,
    },
  });

  console.log("1) Clean import (2 valid rows):");
  const goodBytes = toXlsx([
    { matricNumber: "DIMP/0001", courseCode: "DIMPCS101", ca: 28, exam: 65 },
    { matricNumber: "DIMP/0002", courseCode: "DIMPCS101", ca: 20, exam: 40 },
  ]);
  const r1 = await importResults.execute(
    { semesterId: sem.id, rows: reader.read(goodBytes) },
    admin,
  );
  console.log(
    `   imported ${r1.imported}/${r1.totalRows}, errors ${r1.errors.length}`,
  );

  console.log("2) Batch with an error (unknown matric → nothing written):");
  const badBytes = toXlsx([
    { matricNumber: "DIMP/0001", courseCode: "DIMPCS101", ca: 30, exam: 70 },
    { matricNumber: "DIMP/9999", courseCode: "DIMPCS101", ca: 10, exam: 10 },
  ]);
  const r2 = await importResults.execute(
    { semesterId: sem.id, rows: reader.read(badBytes) },
    admin,
  );
  console.log(
    `   imported ${r2.imported}, errors: ${r2.errors.map((e) => `row ${e.row}: ${e.messages.join("; ")}`).join(" | ")}`,
  );

  console.log("3) Dry run (valid rows, no write):");
  const r3 = await importResults.execute(
    { semesterId: sem.id, rows: reader.read(goodBytes), dryRun: true },
    admin,
  );
  console.log(`   validRows ${r3.validRows}, imported ${r3.imported}`);

  console.log("4) Cleanup:");
  const students = await db.student.findMany({
    where: { matricNumber: { startsWith: "DIMP/" } },
  });
  await db.result.deleteMany({
    where: { studentId: { in: students.map((s) => s.id) } },
  });
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: "DIMP/" } },
  });
  await db.course.deleteMany({ where: { code: { startsWith: "DIMP" } } });
  await db.semester.delete({ where: { id: sem.id } });
  await db.academicSession.delete({ where: { id: sess.id } });
  await db.level.delete({ where: { id: lvl.id } });
  await db.programme.delete({ where: { id: prog.id } });
  await db.department.delete({ where: { id: dep.id } });
  await db.faculty.delete({ where: { id: fac.id } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
