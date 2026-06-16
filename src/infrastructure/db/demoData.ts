/**
 * Demo / UAT sample data. A fresh install has the admin + config but no academic
 * structure, and there is no UI to create faculties/programmes/levels/sessions —
 * so without this a tester can't even admit a student. Seeds one realistic
 * structure, a few courses, and two students (via the real AdmitStudent
 * use-case, so the records are valid). Idempotent (keyed on the faculty code).
 *
 * Enabled only when EARTMP_SEED_DEMO is set — this is a TEST build switch, not
 * for production installs.
 */
import type { PrismaClient } from "@prisma/client";
import { PrismaUnitOfWork } from "../persistence/PrismaUnitOfWork";
import { Argon2HashingService } from "../crypto/Argon2HashingService";
import { AdmitStudent } from "../../application/use-cases/records/AdmitStudent";
import { SessionContext } from "../../domain/value-objects/SessionContext";

const FACULTY_CODE = "SCI";

/**
 * One test account per non-admin role, so RBAC can be exercised from each
 * perspective. Idempotent per username; runs regardless of the structure seed so
 * an already-provisioned test DB still gets them on next launch.
 */
const DEMO_USERS = [
  {
    username: "registrar",
    password: "Registrar123!",
    role: "REGISTRAR",
    fullName: "Test Registrar",
    email: "registrar@example.edu",
  },
  {
    username: "dataentry",
    password: "DataEntry123!",
    role: "DATA_ENTRY",
    fullName: "Test Data Entry",
    email: "dataentry@example.edu",
  },
  {
    username: "viewer",
    password: "Viewer123!",
    role: "VIEWER",
    fullName: "Test Viewer",
    email: "viewer@example.edu",
  },
];

async function seedDemoUsers(prisma: PrismaClient): Promise<void> {
  const hasher = new Argon2HashingService();
  for (const u of DEMO_USERS) {
    const existing = await prisma.user.findUnique({
      where: { username: u.username },
    });
    if (existing) continue;
    const role = await prisma.role.findUnique({ where: { name: u.role } });
    if (!role) continue;
    await prisma.user.create({
      data: {
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        passwordHash: await hasher.hash(u.password),
        roleId: role.id,
        isActive: true,
      },
    });
  }
}

export async function seedDemoData(prisma: PrismaClient): Promise<boolean> {
  // Role test accounts first (ungated, idempotent).
  await seedDemoUsers(prisma);

  const exists = await prisma.faculty.findFirst({
    where: { code: FACULTY_CODE },
  });
  if (exists) return false; // structure already seeded

  // Link the demo faculty to the default institution so the organigram shows it.
  const institution = await prisma.institution.findFirst({
    where: { isDefault: true, deletedAt: null },
  });
  const faculty = await prisma.faculty.create({
    data: {
      name: "Faculty of Science",
      code: FACULTY_CODE,
      institutionId: institution?.id ?? null,
    },
  });
  const dept = await prisma.department.create({
    data: { name: "Computer Science", code: "CSC", facultyId: faculty.id },
  });
  const programme = await prisma.programme.create({
    data: {
      name: "BSc Computer Science",
      code: "CSCB",
      departmentId: dept.id,
    },
  });
  const levels = await Promise.all(
    [100, 200, 300, 400].map((n, i) =>
      prisma.level.create({
        data: { name: String(n), rank: i + 1, programmeId: programme.id },
      }),
    ),
  );
  const level100 = levels[0];
  if (!level100) throw new Error("demo seed: level creation failed");
  const session = await prisma.academicSession.create({
    data: { name: "2024/2025" },
  });
  await prisma.semester.createMany({
    data: [
      { name: "First Semester", rank: 1, sessionId: session.id },
      { name: "Second Semester", rank: 2, sessionId: session.id },
    ],
  });
  await prisma.course.createMany({
    data: [
      {
        code: "CSC101",
        title: "Intro to Computing",
        creditValue: 3,
        programmeId: programme.id,
        levelId: level100.id,
        semesterRank: 1,
      },
      {
        code: "CSC102",
        title: "Programming I",
        creditValue: 3,
        programmeId: programme.id,
        levelId: level100.id,
        semesterRank: 1,
      },
      {
        code: "MTH101",
        title: "Calculus I",
        creditValue: 3,
        programmeId: programme.id,
        levelId: level100.id,
        semesterRank: 1,
      },
      {
        code: "GST101",
        title: "Use of English",
        creditValue: 2,
        programmeId: programme.id,
        levelId: level100.id,
        semesterRank: 1,
      },
    ],
  });

  // Students via the real use-case (atomic student + enrollment).
  const admit = new AdmitStudent(new PrismaUnitOfWork(prisma));
  const session_ctx = SessionContext.create("system", "SUPER_ADMIN", [
    "students.create",
  ]);
  for (const s of [
    { matricNumber: "CSC/2024/001", fullName: "Ada Lovelace" },
    { matricNumber: "CSC/2024/002", fullName: "Alan Turing" },
  ]) {
    await admit.execute(
      {
        matricNumber: s.matricNumber,
        fullName: s.fullName,
        programmeId: programme.id,
        levelId: level100.id,
        fromSession: session.name,
      },
      session_ctx,
    );
  }
  return true;
}
