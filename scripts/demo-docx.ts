/**
 * Runnable DOCX-export demo (DEV-ONLY). Same flow as demo:pdf but with the
 * DocxRenderer — proving the Phase 13 port design: ExportTranscript is unchanged,
 * only the renderer + content-type/extension differ. Cleans up.
 * Run: npm run db:seed && npm run demo:docx
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaTranscriptRepository } from "../src/infrastructure/repositories/PrismaTranscriptRepository";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { DocxRenderer } from "../src/infrastructure/reporting/docx/DocxRenderer";
import { ExportTranscript } from "../src/application/use-cases/transcripts/ExportTranscript";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ResolvedDoc } from "../src/domain/services/TranscriptReportData";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}

async function main(): Promise<void> {
  const db = getPrisma();
  const exporter = new ExportTranscript(
    new PrismaTranscriptRepository(db),
    new DocxRenderer(),
    new PrismaAuditLogAdapter(db),
    DOCX_TYPE,
    "docx",
  );
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "transcripts.read",
  ]);

  const template = await db.transcriptTemplate.findFirst({
    where: { isDefault: true },
  });
  const fac = await db.faculty.create({
    data: { name: "DDocx", code: "DDOCX" },
  });
  const dep = await db.department.create({
    data: { name: "CS", code: "DDOCXCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc", code: "DDOCXB", departmentId: dep.id },
  });
  const student = await db.student.create({
    data: {
      matricNumber: "DDOCX/0001",
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
          { label: "Matric", value: "DDOCX/0001" },
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
      { type: "signatureRow", items: [{ role: "Registrar", name: "Dr X" }] },
      { type: "qr", payload: "DDOCX-1", caption: "DDOCX-1" },
    ],
  };
  const t = await db.transcript.create({
    data: {
      transcriptNumber: "DDOCX-1",
      studentId: student.id,
      templateId: template!.id,
      type: "ACADEMIC_TRANSCRIPT",
      snapshot: JSON.stringify({ resolvedDoc }),
      verificationHash: "{}",
      status: "DRAFT",
    },
  });

  console.log("1) DRAFT preview (banner):");
  const preview = await exporter.execute(
    { transcriptId: t.id, preview: true },
    admin,
  );
  console.log(
    `   ${preview.filename}: ${preview.bytes.length} bytes, PK=${isZip(preview.bytes)}, type=${preview.contentType === DOCX_TYPE}`,
  );

  console.log("2) Approve, official export:");
  await db.transcript.update({
    where: { id: t.id },
    data: { status: "APPROVED" },
  });
  const official = await exporter.execute({ transcriptId: t.id }, admin);
  console.log(
    `   ${official.filename}: ${official.bytes.length} bytes, PK=${isZip(official.bytes)}`,
  );

  console.log("3) Cleanup:");
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
