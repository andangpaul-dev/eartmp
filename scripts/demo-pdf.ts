/**
 * Runnable PDF-export demo (DEV-ONLY). Creates a transcript with a small
 * resolved-doc snapshot, exports a DRAFT preview (watermarked) and — after
 * approval — an official PDF, proving real PDF bytes. Cleans up.
 * Run: npm run db:seed && npm run demo:pdf
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaTranscriptRepository } from "../src/infrastructure/repositories/PrismaTranscriptRepository";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { PdfMakeRenderer } from "../src/infrastructure/reporting/pdf/PdfMakeRenderer";
import { ExportTranscript } from "../src/application/use-cases/transcripts/ExportTranscript";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ResolvedDoc } from "../src/domain/services/TranscriptReportData";

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

async function main(): Promise<void> {
  const db = getPrisma();
  const transcripts = new PrismaTranscriptRepository(db);
  const exporter = new ExportTranscript(
    transcripts,
    new PdfMakeRenderer(),
    new PrismaAuditLogAdapter(db),
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "transcripts.read",
  ]);

  const template = await db.transcriptTemplate.findFirst({
    where: { isDefault: true },
  });
  const fac = await db.faculty.create({ data: { name: "DPdf", code: "DPDF" } });
  const dep = await db.department.create({
    data: { name: "CS", code: "DPDFCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DPDFB", departmentId: dep.id },
  });
  const student = await db.student.create({
    data: {
      matricNumber: "DPDF/0001",
      fullName: "Ada Lovelace",
      programmeId: prog.id,
    },
  });

  const resolvedDoc: ResolvedDoc = {
    pageSize: "A4",
    blocks: [
      { type: "title", text: "ACADEMIC TRANSCRIPT" },
      {
        type: "fieldGrid",
        columns: 2,
        fields: [
          { label: "Name", value: "Ada Lovelace" },
          { label: "Matric", value: "DPDF/0001" },
        ],
      },
      {
        type: "courseTable",
        heading: "2024/2025 — First Semester",
        columns: [{ header: "Code" }, { header: "Grade" }],
        rows: [["CS101", "A"]],
        footer: [{ label: "Semester GPA", value: "4.0" }],
      },
      { type: "summary", fields: [{ label: "CGPA", value: "4.0" }] },
      { type: "qr", payload: "DPDF-1", caption: "DPDF-1" },
    ],
  };
  const snapshot = JSON.stringify({ resolvedDoc, issuedAt: "2026-01-01" });
  const t = await db.transcript.create({
    data: {
      transcriptNumber: "DPDF-1",
      studentId: student.id,
      templateId: template!.id,
      type: "ACADEMIC_TRANSCRIPT",
      snapshot,
      verificationHash: "{}",
      status: "DRAFT",
    },
  });

  console.log("1) Official export of a DRAFT is rejected:");
  try {
    await exporter.execute({ transcriptId: t.id }, admin);
    console.log("   ✗ unexpectedly exported");
  } catch (e) {
    console.log(`   ✓ rejected (${(e as Error).name})`);
  }

  console.log("2) DRAFT preview (watermarked):");
  const preview = await exporter.execute(
    { transcriptId: t.id, preview: true },
    admin,
  );
  console.log(
    `   ${preview.filename}: ${preview.bytes.length} bytes, %PDF=${isPdf(preview.bytes)}`,
  );

  console.log("3) Approve, then official export:");
  await db.transcript.update({
    where: { id: t.id },
    data: { status: "APPROVED" },
  });
  const official = await exporter.execute({ transcriptId: t.id }, admin);
  console.log(
    `   ${official.filename}: ${official.bytes.length} bytes, %PDF=${isPdf(official.bytes)}`,
  );

  console.log("4) Cleanup:");
  await db.transcript.deleteMany({ where: { studentId: student.id } });
  await db.student.delete({ where: { id: student.id } });
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
