/**
 * Results + Import host smoke (Milestone 4). Proves the M4 paths through the
 * host + gate, exactly as the webview calls them:
 *   results: getAssessmentStructure → previewFinalScore (core math, not client)
 *            → enterResult ×2 → getStudentSemesterResults → processSemester
 *            (locks) → unlockResult (audited).
 *   import:  parseWorkbook (base64 xlsx, parsed on the host) → importResults
 *            dryRun (no write) → importResults commit (all-or-nothing).
 * Provisions its own structure (FKs) and removes it.
 * Run: npm run db:seed && tsx scripts/host-smoke-results.ts
 */
import * as XLSX from "xlsx";
import { getPrisma } from "../src/infrastructure/db/prisma";
import { buildHost } from "../src/host/composition";
import { createCore } from "../src/host/dispatcher";
import type { RawRow } from "../src/application/ports/SpreadsheetReaderPort";

const P = "SMK4"; // unique prefix for this smoke's data

function xlsxBase64(rows: RawRow[]): string {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const bytes = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  }) as Uint8Array;
  return Buffer.from(bytes).toString("base64");
}

async function main(): Promise<void> {
  const db = getPrisma();
  const core = createCore(buildHost(db));

  // --- structure prerequisites (FKs) ---
  const fac = await db.faculty.create({ data: { name: P, code: P } });
  const dep = await db.department.create({
    data: { name: "CS", code: `${P}CS`, facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc CS", code: `${P}B`, departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({
    data: { name: `${P} 24/25` },
  });
  const sem = await db.semester.create({
    data: { name: "First Semester", rank: 1, sessionId: sess.id },
  });
  const cs = await db.course.create({
    data: {
      code: `${P}CS101`,
      title: "Algorithms",
      creditValue: 3,
      programmeId: prog.id,
    },
  });
  const ma = await db.course.create({
    data: {
      code: `${P}MA101`,
      title: "Analysis",
      creditValue: 2,
      programmeId: prog.id,
    },
  });

  const { token } = await core.login({
    username: "admin",
    password: "ChangeMe123!",
  });

  // student for the manual-entry path
  const admit = await core.dispatch(
    "admitStudent",
    {
      matricNumber: `${P}/0001`,
      fullName: "Grace Hopper",
      programmeId: prog.id,
      levelId: lvl.id,
      fromSession: sess.name,
    },
    token,
  );
  const studentId = admit.ok
    ? (admit.data as { student: { id: string } }).student.id
    : "";
  // two students for the import path
  await core.dispatch(
    "admitStudent",
    {
      matricNumber: `${P}/0002`,
      fullName: "Alan Turing",
      programmeId: prog.id,
      levelId: lvl.id,
      fromSession: sess.name,
    },
    token,
  );
  await core.dispatch(
    "admitStudent",
    {
      matricNumber: `${P}/0003`,
      fullName: "Edsger Dijkstra",
      programmeId: prog.id,
      levelId: lvl.id,
      fromSession: sess.name,
    },
    token,
  );

  let ok = true;
  const check = (label: string, pass: boolean, extra = ""): void => {
    ok = ok && pass;
    console.log(`   ${pass ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  };

  console.log("1) getAssessmentStructure:");
  const struct = await core.dispatch("getAssessmentStructure", {}, token);
  const components = struct.ok ? (struct.data as { key: string }[]) : [];
  check(
    "structure loaded",
    struct.ok && components.length > 0,
    `${components.length} components`,
  );

  console.log("2) previewFinalScore (core math):");
  const scores = [
    { key: "ca", score: 28 },
    { key: "exam", score: 65 },
  ];
  const prev = await core.dispatch(
    "previewFinalScore",
    { componentScores: scores },
    token,
  );
  check(
    "final score computed",
    prev.ok && typeof prev.data === "number",
    `= ${prev.ok ? prev.data : "?"}`,
  );

  console.log("3) enterResult ×2:");
  const e1 = await core.dispatch(
    "enterResult",
    { studentId, courseId: cs.id, semesterId: sem.id, componentScores: scores },
    token,
  );
  const e2 = await core.dispatch(
    "enterResult",
    {
      studentId,
      courseId: ma.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 27 },
        { key: "exam", score: 63 },
      ],
    },
    token,
  );
  check("both entered", e1.ok && e2.ok);

  console.log("4) getStudentSemesterResults:");
  const got = await core.dispatch(
    "getStudentSemesterResults",
    { studentId, semesterId: sem.id },
    token,
  );
  check("two results returned", got.ok && (got.data as unknown[]).length === 2);

  console.log("5) processSemester then lockSemesterResults (UI finalize):");
  const proc = await core.dispatch(
    "processSemester",
    { studentId, semesterId: sem.id },
    token,
  );
  const lock = proc.ok
    ? await core.dispatch(
        "lockSemesterResults",
        { studentId, semesterId: sem.id },
        token,
      )
    : proc;
  check(
    "processed & locked",
    proc.ok && lock.ok,
    proc.ok ? `GPA ${(proc.data as { gpa: number }).gpa}` : proc.error.code,
  );

  console.log("6) results now locked:");
  const locked = await core.dispatch(
    "getStudentSemesterResults",
    { studentId, semesterId: sem.id },
    token,
  );
  const lockedRows = locked.ok
    ? (locked.data as { id: string; isLocked: boolean }[])
    : [];
  check(
    "all locked",
    lockedRows.length > 0 && lockedRows.every((r) => r.isLocked),
  );

  console.log("7) re-enter into a locked result → LOCKED:");
  const blocked = await core.dispatch(
    "enterResult",
    { studentId, courseId: cs.id, semesterId: sem.id, componentScores: scores },
    token,
  );
  check(
    "rejected",
    !blocked.ok,
    blocked.ok ? "ALLOWED (BAD)" : blocked.error.code,
  );

  console.log("8) unlockResult (audited):");
  const un = await core.dispatch(
    "unlockResult",
    { resultId: lockedRows[0].id },
    token,
  );
  check("unlocked", un.ok, un.ok ? "" : un.error.code);

  console.log("9) parseWorkbook (base64 xlsx, parsed on host):");
  const goodRows: RawRow[] = [
    { matricNumber: `${P}/0002`, courseCode: `${P}CS101`, ca: 25, exam: 60 },
    { matricNumber: `${P}/0003`, courseCode: `${P}CS101`, ca: 20, exam: 40 },
  ];
  const parsed = await core.dispatch(
    "parseWorkbook",
    { base64: xlsxBase64(goodRows) },
    token,
  );
  const rows = parsed.ok ? (parsed.data as RawRow[]) : [];
  check("parsed", parsed.ok && rows.length === 2, `${rows.length} rows`);

  console.log("10) importResults dryRun (no write):");
  const dry = await core.dispatch(
    "importResults",
    { semesterId: sem.id, rows, dryRun: true },
    token,
  );
  check(
    "valid & no errors",
    dry.ok &&
      (dry.data as { validRows: number; errors: unknown[] }).errors.length ===
        0,
    dry.ok
      ? `${(dry.data as { validRows: number }).validRows} valid`
      : dry.error.code,
  );

  console.log("11) importResults with a bad row → all-or-nothing:");
  const badRows: RawRow[] = [
    { matricNumber: `${P}/0002`, courseCode: `${P}CS101`, ca: 30, exam: 70 },
    { matricNumber: `${P}/9999`, courseCode: `${P}CS101`, ca: 10, exam: 10 },
  ];
  const bad = await core.dispatch(
    "importResults",
    { semesterId: sem.id, rows: badRows },
    token,
  );
  check(
    "reported errors, wrote nothing",
    bad.ok &&
      (bad.data as { imported: number; errors: unknown[] }).errors.length > 0 &&
      (bad.data as { imported: number }).imported === 0,
  );

  console.log("12) importResults commit (all valid):");
  const commit = await core.dispatch(
    "importResults",
    { semesterId: sem.id, rows },
    token,
  );
  check(
    "committed",
    commit.ok && (commit.data as { imported: number }).imported === 2,
    commit.ok
      ? `${(commit.data as { imported: number }).imported} imported`
      : commit.error.code,
  );

  console.log("13) Cleanup:");
  const studs = await db.student.findMany({
    where: { matricNumber: { startsWith: `${P}/` } },
  });
  const ids = studs.map((s) => s.id);
  await db.result.deleteMany({ where: { studentId: { in: ids } } });
  await db.studentEnrollment.deleteMany({ where: { studentId: { in: ids } } });
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: `${P}/` } },
  });
  await db.course.deleteMany({ where: { code: { startsWith: P } } });
  await db.semester.delete({ where: { id: sem.id } });
  await db.academicSession.delete({ where: { id: sess.id } });
  await db.level.delete({ where: { id: lvl.id } });
  await db.programme.delete({ where: { id: prog.id } });
  await db.department.delete({ where: { id: dep.id } });
  await db.faculty.delete({ where: { id: fac.id } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
  console.log(`\nResults + Import host smoke: ${ok ? "GREEN ✅" : "RED ❌"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
