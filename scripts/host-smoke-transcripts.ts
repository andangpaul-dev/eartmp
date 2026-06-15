/**
 * Summary + Transcripts + Graduation + Audit host smoke (Milestone 5). Drives
 * the M5 paths through the host + gate exactly as the webview does:
 *   summary:    getAcademicSummary (CGPA aggregate).
 *   key:        keyState (sealed) → generate refused while sealed → unseal
 *               (wrong passphrase refused) → keyState (unsealed) → seal.
 *   transcript: generate (DRAFT, signed) → verify (Ed25519) → official export
 *               refused while DRAFT → preview (watermarked PDF) → approve →
 *               official export (PDF) → list.
 *   graduation: evaluate (transparent criteria) → clear when eligible.
 *   audit:      getAuditLog → verifyAuditChain (tamper-evident).
 * Needs the seed (institution + template + sealed keypair). Provisions its own
 * structure/results and removes them.
 * Run: npm run db:seed && tsx scripts/host-smoke-transcripts.ts
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { buildHost } from "../src/host/composition";
import { createCore } from "../src/host/dispatcher";

const P = "SMK5";
const PASS = process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase";

function isPdfB64(base64: string): boolean {
  const head = Buffer.from(base64.slice(0, 8), "base64");
  return head[0] === 0x25 && head[1] === 0x50; // %P
}

async function main(): Promise<void> {
  const db = getPrisma();
  const core = createCore(buildHost(db));

  // --- structure + a processed, locked semester so summary/transcript have data
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

  const { token } = await core.login({
    username: "admin",
    password: "ChangeMe123!",
  });

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
  await core.dispatch(
    "enterResult",
    {
      studentId,
      courseId: cs.id,
      semesterId: sem.id,
      componentScores: [
        { key: "ca", score: 28 },
        { key: "exam", score: 65 },
      ],
    },
    token,
  );
  await core.dispatch(
    "processSemester",
    { studentId, semesterId: sem.id },
    token,
  );
  await core.dispatch(
    "lockSemesterResults",
    { studentId, semesterId: sem.id },
    token,
  );

  let ok = true;
  const check = (label: string, pass: boolean, extra = ""): void => {
    ok = ok && pass;
    console.log(`   ${pass ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  };

  console.log("1) getAcademicSummary:");
  const sum = await core.dispatch("getAcademicSummary", { studentId }, token);
  check(
    "summary",
    sum.ok,
    sum.ok
      ? `CGPA ${(sum.data as { cgpa: number }).cgpa}, standing ${(sum.data as { standing: string }).standing}`
      : sum.error.code,
  );

  console.log("2) keyState is sealed on a fresh host:");
  const k0 = await core.dispatch("keyState", {}, token);
  check("sealed", k0.ok && (k0.data as { sealed: boolean }).sealed);

  console.log("3) generateTranscript refused while sealed:");
  const g0 = await core.dispatch("generateTranscript", { studentId }, token);
  check("refused", !g0.ok, g0.ok ? "ALLOWED (BAD)" : g0.error.code);

  console.log("4) unsealKey with wrong passphrase refused:");
  const bad = await core.dispatch(
    "unsealKey",
    { passphrase: "not-the-passphrase" },
    token,
  );
  check("refused", !bad.ok, bad.ok ? "ALLOWED (BAD)" : bad.error.code);

  console.log("5) unsealKey with correct passphrase:");
  const un = await core.dispatch("unsealKey", { passphrase: PASS }, token);
  check("unsealed", un.ok && !(un.data as { sealed: boolean }).sealed);

  console.log("6) generateTranscript (DRAFT, signed):");
  const gen = await core.dispatch("generateTranscript", { studentId }, token);
  const tx = gen.ok
    ? (gen.data as { id: string; transcriptNumber: string; status: string })
    : null;
  check(
    "generated",
    gen.ok && tx?.status === "DRAFT",
    tx ? `${tx.transcriptNumber} (${tx.status})` : gen.ok ? "" : gen.error.code,
  );

  console.log("7) verifyTranscript (Ed25519):");
  const ver = tx
    ? await core.dispatch("verifyTranscript", { transcriptId: tx.id }, token)
    : g0;
  // A DRAFT has a valid signature but is not yet an "issued" (valid) transcript.
  check(
    "valid signature",
    ver.ok && (ver.data as { signatureValid: boolean }).signatureValid,
  );

  console.log("8) official export refused while DRAFT:");
  const exDraft = tx
    ? await core.dispatch("exportTranscript", { transcriptId: tx.id }, token)
    : g0;
  check(
    "refused",
    !exDraft.ok,
    exDraft.ok ? "ALLOWED (BAD)" : exDraft.error.code,
  );

  console.log("9) preview export (watermarked PDF):");
  const prev = tx
    ? await core.dispatch(
        "exportTranscript",
        { transcriptId: tx.id, preview: true },
        token,
      )
    : g0;
  check(
    "PDF produced",
    prev.ok && isPdfB64((prev.data as { base64: string }).base64),
    prev.ok ? (prev.data as { filename: string }).filename : prev.error.code,
  );

  console.log("10) approveTranscript:");
  const appr = tx
    ? await core.dispatch("approveTranscript", { transcriptId: tx.id }, token)
    : g0;
  check(
    "approved",
    appr.ok && (appr.data as { status: string }).status === "APPROVED",
  );

  console.log("11) official export now succeeds (PDF):");
  const exOk = tx
    ? await core.dispatch("exportTranscript", { transcriptId: tx.id }, token)
    : g0;
  check(
    "PDF produced",
    exOk.ok && isPdfB64((exOk.data as { base64: string }).base64),
    exOk.ok ? (exOk.data as { filename: string }).filename : exOk.error.code,
  );

  console.log("12) listTranscripts:");
  const ls = await core.dispatch("listTranscripts", { studentId }, token);
  check("one transcript", ls.ok && (ls.data as unknown[]).length === 1);

  console.log("13) evaluateGraduation (transparent criteria):");
  const elig = await core.dispatch("evaluateGraduation", { studentId }, token);
  const report = elig.ok
    ? (elig.data as { eligible: boolean; criteria: unknown[] })
    : null;
  check(
    "evaluated",
    elig.ok && (report?.criteria.length ?? 0) > 0,
    report ? `eligible=${report.eligible}` : elig.error.code,
  );

  console.log("14) graduateStudent (only when eligible):");
  if (report?.eligible) {
    const grad = await core.dispatch("graduateStudent", { studentId }, token);
    check(
      "cleared",
      grad.ok && (grad.data as { status: string }).status === "GRADUATED",
    );
  } else {
    const grad = await core.dispatch("graduateStudent", { studentId }, token);
    check(
      "not-eligible refused",
      !grad.ok,
      grad.ok ? "ALLOWED (BAD)" : grad.error.code,
    );
  }

  console.log("15) getAuditLog:");
  const al = await core.dispatch("getAuditLog", { take: 10 }, token);
  check(
    "entries returned",
    al.ok && (al.data as { total: number }).total > 0,
    al.ok ? `total ${(al.data as { total: number }).total}` : al.error.code,
  );

  console.log("16) verifyAuditChain (tamper-evident):");
  const chain = await core.dispatch("verifyAuditChain", {}, token);
  check(
    "chain valid",
    chain.ok && (chain.data as { valid: boolean }).valid,
    chain.ok
      ? `checked ${(chain.data as { checked: number }).checked}`
      : chain.error.code,
  );

  console.log("17) sealKey:");
  const seal = await core.dispatch("sealKey", {}, token);
  check("sealed", seal.ok && (seal.data as { sealed: boolean }).sealed);

  console.log("18) Cleanup:");
  await db.transcript.deleteMany({ where: { studentId } });
  await db.result.deleteMany({ where: { studentId } });
  await db.studentEnrollment.deleteMany({ where: { studentId } });
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
  console.log(
    `\nSummary + Transcripts + Graduation + Audit host smoke: ${ok ? "GREEN ✅" : "RED ❌"}`,
  );
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
