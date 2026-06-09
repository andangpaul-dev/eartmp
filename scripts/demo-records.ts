/**
 * Runnable students/courses demo (DEV-ONLY). Exercises the Phase 6 use-cases
 * against the seeded dev.db: create a student + course, drive the status
 * workflow, enroll + transfer (enrollment history), and a paginated list.
 * Builds minimal structure prerequisites and removes everything it created so
 * it is re-runnable. Run: npm run db:seed && npm run demo:records
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaStudentRepository,
  PrismaCourseRepository,
  PrismaStudentEnrollmentRepository,
} from "../src/infrastructure/repositories/PrismaRecordsRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  CreateStudent,
  ChangeStudentStatus,
  ListStudents,
} from "../src/application/use-cases/records/ManageStudents";
import {
  EnrollStudent,
  TransferStudent,
  GetEnrollmentHistory,
} from "../src/application/use-cases/records/ManageEnrollment";
import { CreateCourse } from "../src/application/use-cases/records/ManageCourses";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const students = new PrismaStudentRepository(db);
  const courses = new PrismaCourseRepository(db);
  const enrollments = new PrismaStudentEnrollmentRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "students.create",
    "students.read",
    "students.update",
    "courses.create",
    "courses.read",
  ]);

  // Prerequisites (two programmes + levels) for enrollment/transfer.
  const fac = await db.faculty.create({
    data: { name: "Demo Sci", code: "DREC" },
  });
  const dep = await db.department.create({
    data: { name: "Demo CS", code: "DRECCS", facultyId: fac.id },
  });
  const progA = await db.programme.create({
    data: { name: "BSc A", code: "DRECA", departmentId: dep.id },
  });
  const progB = await db.programme.create({
    data: { name: "BSc B", code: "DRECB", departmentId: dep.id },
  });
  const lvlA = await db.level.create({
    data: { name: "100", rank: 1, programmeId: progA.id },
  });
  const lvlB = await db.level.create({
    data: { name: "100", rank: 1, programmeId: progB.id },
  });

  console.log("1) Create student + course:");
  const student = await new CreateStudent(students, audit).execute(
    { matricNumber: "DREC/0001", fullName: "Ada Lovelace" },
    admin,
  );
  const course = await new CreateCourse(courses, audit).execute(
    {
      code: "DRECSC101",
      title: "Intro CS",
      creditValue: 3,
      courseType: "CORE",
    },
    admin,
  );
  console.log(
    `   ${student.matricNumber} (${student.status}), course ${course.code}`,
  );

  console.log("2) Status workflow:");
  const changeStatus = new ChangeStudentStatus(students, audit);
  await changeStatus.execute({ studentId: student.id, to: "DEFERRED" }, admin);
  try {
    await changeStatus.execute(
      { studentId: student.id, to: "GRADUATED" },
      admin,
    );
    console.log("   ✗ illegal DEFERRED→GRADUATED allowed (BAD)");
  } catch {
    console.log("   ✓ illegal DEFERRED→GRADUATED rejected");
  }
  await changeStatus.execute({ studentId: student.id, to: "ACTIVE" }, admin);
  console.log("   back to ACTIVE");

  console.log("3) Enroll + transfer (history):");
  await new EnrollStudent(enrollments, students, audit).execute(
    {
      studentId: student.id,
      programmeId: progA.id,
      levelId: lvlA.id,
      fromSession: "DREC 24/25",
    },
    admin,
  );
  await new TransferStudent(enrollments, students, audit).execute(
    {
      studentId: student.id,
      toProgrammeId: progB.id,
      toLevelId: lvlB.id,
      asOfSession: "DREC 25/26",
    },
    admin,
  );
  const history = await new GetEnrollmentHistory(enrollments).execute(
    { studentId: student.id },
    admin,
  );
  console.log(
    `   ${history.length} enrollments; current programme = ${history.find((e) => e.isCurrent)?.programmeId === progB.id ? "B (transferred)" : "?"}`,
  );

  console.log("4) Paginated list (take 1):");
  const page = await new ListStudents(students).execute(
    { where: { search: "DREC" }, take: 1 },
    admin,
  );
  console.log(`   returned ${page.items.length} of total ${page.total}`);

  console.log("5) Cleanup:");
  await db.studentEnrollment.deleteMany({ where: { studentId: student.id } });
  await db.student.deleteMany({
    where: { matricNumber: { startsWith: "DREC" } },
  });
  await db.course.deleteMany({ where: { code: { startsWith: "DREC" } } });
  await db.level.deleteMany({ where: { id: { in: [lvlA.id, lvlB.id] } } });
  await db.programme.deleteMany({
    where: { id: { in: [progA.id, progB.id] } },
  });
  await db.department.deleteMany({ where: { id: dep.id } });
  await db.faculty.deleteMany({ where: { id: fac.id } });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
