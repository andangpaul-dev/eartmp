/**
 * Students host smoke (Milestone 3). Proves the mutate path through the host +
 * gate: admit a student, reject a duplicate matric (CONFLICT), list, transition
 * status, then clean up. Provisions its own structure (FKs) and removes it.
 * Run: npm run db:seed && tsx scripts/host-smoke-students.ts
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { buildHost } from "../src/host/composition";
import { createCore } from "../src/host/dispatcher";

async function main(): Promise<void> {
  const db = getPrisma();
  const core = createCore(buildHost(db));

  // structure prerequisites (FKs for admit)
  const fac = await db.faculty.create({
    data: { name: "SmkSci", code: "SMK" },
  });
  const dep = await db.department.create({
    data: { name: "CS", code: "SMKCS", facultyId: fac.id },
  });
  const prog = await db.programme.create({
    data: { name: "BSc CS", code: "SMKB", departmentId: dep.id },
  });
  const lvl = await db.level.create({
    data: { name: "100", rank: 1, programmeId: prog.id },
  });
  const sess = await db.academicSession.create({ data: { name: "SMK 24/25" } });

  const { token } = await core.login({
    username: "admin",
    password: "ChangeMe123!",
  });
  const admitInput = {
    matricNumber: "SMK/0001",
    fullName: "Grace Hopper",
    programmeId: prog.id,
    levelId: lvl.id,
    facultyId: fac.id,
    departmentId: dep.id,
    admissionSession: sess.name,
  };

  console.log("1) admitStudent:");
  const a = await core.dispatch("admitStudent", admitInput, token);
  console.log(
    a.ok
      ? `   ✓ admitted ${(a.data as { student: { matricNumber: string } }).student.matricNumber}`
      : `   ✗ ${a.error.code}`,
  );
  const studentId = a.ok
    ? (a.data as { student: { id: string } }).student.id
    : "";

  console.log("2) duplicate matric → CONFLICT:");
  const dup = await core.dispatch("admitStudent", admitInput, token);
  console.log(
    dup.ok ? "   ✗ allowed (BAD)" : `   ✓ rejected (${dup.error.code})`,
  );

  console.log("3) listStudents (search SMK):");
  const list = await core.dispatch(
    "listStudents",
    { where: { search: "SMK" }, take: 5 },
    token,
  );
  console.log(
    list.ok
      ? `   ✓ total=${(list.data as { total: number }).total}`
      : `   ✗ ${list.error.code}`,
  );

  console.log("4) changeStudentStatus ACTIVE → SUSPENDED:");
  const st = await core.dispatch(
    "changeStudentStatus",
    { studentId, to: "SUSPENDED" },
    token,
  );
  console.log(
    st.ok
      ? `   ✓ status=${(st.data as { status: string }).status}`
      : `   ✗ ${st.error.code}`,
  );

  console.log("5) Cleanup:");
  await db.studentEnrollment.deleteMany({ where: { studentId } });
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: "SMK/" } },
  });
  await db.level.delete({ where: { id: lvl.id } });
  await db.programme.delete({ where: { id: prog.id } });
  await db.department.delete({ where: { id: dep.id } });
  await db.faculty.delete({ where: { id: fac.id } });
  await db.academicSession.delete({ where: { id: sess.id } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
  console.log("\nStudents host smoke: GREEN ✅");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
