/**
 * Idempotent database seed.
 *
 * Provisions the minimum configuration every install needs:
 *   - RBAC catalog (placeholder roles + permissions) — `[ASSUMPTION]`, replace
 *     with the real catalog when the SDP is supplied.
 *   - one default GradeScale (validated 0–100, no gaps/overlaps)
 *   - one default AssessmentConfig (weights sum to 100)
 *   - Transcript Template V1 (stub layout)
 *   - the singleton Institution row
 *
 * Safe to run repeatedly: every write is an upsert keyed on a unique/stable
 * field, so re-seeding never duplicates rows. Run with `npm run db:seed`
 * (after `prisma generate` + `prisma migrate`).
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Argon2HashingService } from "../src/infrastructure/crypto/Argon2HashingService";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../src/domain/settings/SettingsRegistry";

const prisma = new PrismaClient();

// Stable id for the singleton institution so re-seeding is idempotent.
const INSTITUTION_ID = "seed-institution-001";

const PERMISSIONS: { key: string; label: string }[] = [
  { key: "students.read", label: "View students" },
  { key: "students.create", label: "Create students" },
  { key: "students.update", label: "Edit students" },
  { key: "results.import", label: "Import results" },
  { key: "results.process", label: "Process results" },
  { key: "results.unlock", label: "Unlock locked results" },
  { key: "transcripts.generate", label: "Generate transcripts" },
  { key: "transcripts.approve", label: "Approve transcripts" },
  { key: "config.manage", label: "Manage grading/assessment config" },
  { key: "backup.restore", label: "Restore backups" },
  { key: "audit.read", label: "View the audit log" },
  { key: "users.read", label: "View users" },
  { key: "users.create", label: "Create users" },
  { key: "users.update", label: "Edit/deactivate users" },
  { key: "roles.read", label: "View roles" },
  { key: "roles.assign", label: "Assign roles to users" },
  { key: "institution.manage", label: "Edit institution profile" },
  { key: "settings.read", label: "View settings" },
  { key: "settings.manage", label: "Edit settings" },
  { key: "structure.read", label: "View academic structure" },
  { key: "structure.manage", label: "Manage academic structure" },
];

// `[ASSUMPTION]` placeholder roles → permission sets. Reconcile with real SDP.
const ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: "SUPER_ADMIN",
    description: "Full access",
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    name: "REGISTRAR",
    description: "Records + transcripts + approvals",
    permissions: [
      "students.read",
      "students.create",
      "students.update",
      "results.process",
      "results.unlock",
      "transcripts.generate",
      "transcripts.approve",
      "audit.read",
      "settings.read",
      "structure.read",
      "structure.manage",
    ],
  },
  {
    name: "DATA_ENTRY",
    description: "Enter/import results, no approvals",
    permissions: ["students.read", "results.import", "results.process"],
  },
  {
    name: "VIEWER",
    description: "Read-only",
    permissions: ["students.read", "audit.read"],
  },
];

// `[ASSUMPTION]` example 5-point scale; the real institution scale is config.
const DEFAULT_GRADE_BANDS = [
  { minMark: 70, maxMark: 100, grade: "A", gradePoint: 4.0, isPass: true },
  { minMark: 60, maxMark: 69, grade: "B", gradePoint: 3.0, isPass: true },
  { minMark: 50, maxMark: 59, grade: "C", gradePoint: 2.0, isPass: true },
  { minMark: 45, maxMark: 49, grade: "D", gradePoint: 1.0, isPass: true },
  { minMark: 0, maxMark: 44, grade: "F", gradePoint: 0.0, isPass: false },
];

const DEFAULT_ASSESSMENT_COMPONENTS = [
  { key: "ca", label: "Continuous Assessment", weight: 30, maxScore: 30 },
  { key: "exam", label: "Examination", weight: 70, maxScore: 70 },
];

// Minimal Transcript Template V1 stub. Replaced with the real sample layout
// when supplied (see docs/phase-0/transcript-template-architecture.md).
const TEMPLATE_V1_LAYOUT = {
  schemaVersion: 1,
  pageSize: "A4",
  blocks: [
    { type: "title", value: "ACADEMIC TRANSCRIPT" },
    {
      type: "fieldGrid",
      columns: 2,
      fields: [
        { label: "Name", bind: "student.fullName" },
        { label: "Matric No.", bind: "student.matricNumber" },
      ],
    },
    { type: "summary", fields: [{ label: "CGPA", bind: "summary.cgpa" }] },
    { type: "qr", bind: "verification.qrPayload" },
  ],
};

async function seedPermissions(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label },
      create: { key: p.key, label: p.label },
    });
    byKey.set(p.key, row.id);
  }
  return byKey;
}

async function seedRoles(permIds: Map<string, string>): Promise<void> {
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: { name: r.name, description: r.description },
    });
    for (const key of r.permissions) {
      const permissionId = permIds.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}

async function seedConfig(): Promise<void> {
  await prisma.gradeScale.upsert({
    where: { name: "Default 5-Point Scale" },
    update: { bands: JSON.stringify(DEFAULT_GRADE_BANDS), isDefault: true },
    create: {
      name: "Default 5-Point Scale",
      bands: JSON.stringify(DEFAULT_GRADE_BANDS),
      isDefault: true,
    },
  });

  await prisma.assessmentConfig.upsert({
    where: { name: "Default CA + Exam" },
    update: {
      components: JSON.stringify(DEFAULT_ASSESSMENT_COMPONENTS),
      isDefault: true,
    },
    create: {
      name: "Default CA + Exam",
      components: JSON.stringify(DEFAULT_ASSESSMENT_COMPONENTS),
      isDefault: true,
    },
  });

  await prisma.transcriptTemplate.upsert({
    where: { name: "Official Transcript" },
    update: {
      layout: JSON.stringify(TEMPLATE_V1_LAYOUT),
      version: 1,
      isDefault: true,
    },
    create: {
      name: "Official Transcript",
      version: 1,
      layout: JSON.stringify(TEMPLATE_V1_LAYOUT),
      isDefault: true,
    },
  });
}

async function seedInstitution(): Promise<void> {
  await prisma.institution.upsert({
    where: { id: INSTITUTION_ID },
    update: {},
    create: {
      id: INSTITUTION_ID,
      name: "Example University", // `[ASSUMPTION]` placeholder
      calendarType: "SEMESTER",
    },
  });
}

// `[ASSUMPTION]` default admin for first login. Password is hashed (Argon2id);
// the plaintext is a placeholder that MUST be changed on first use. The password
// is only set on create, so re-seeding never rewrites it.
const DEFAULT_ADMIN = {
  username: "admin",
  email: "admin@example.edu",
  fullName: "System Administrator",
  password: "ChangeMe123!",
};

async function seedAdminUser(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username: DEFAULT_ADMIN.username },
  });
  if (existing) return; // idempotent: never rewrite an existing admin password

  const superAdmin = await prisma.role.findUnique({
    where: { name: "SUPER_ADMIN" },
  });
  if (!superAdmin)
    throw new Error("SUPER_ADMIN role missing; seed roles first.");

  const passwordHash = await new Argon2HashingService().hash(
    DEFAULT_ADMIN.password,
  );
  await prisma.user.create({
    data: {
      username: DEFAULT_ADMIN.username,
      email: DEFAULT_ADMIN.email,
      fullName: DEFAULT_ADMIN.fullName,
      passwordHash,
      roleId: superAdmin.id,
      isActive: true,
    },
  });
}

// Seed default settings as validated JSON envelopes via the SettingsRegistry.
// Only created if absent (idempotent); the encryption salt is generated once.
async function seedSettings(): Promise<void> {
  const registry = buildDefaultRegistry();
  for (const key of registry.keys()) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (existing) continue;
    const value =
      key === SETTING_KEYS.encryptionSalt
        ? randomBytes(16).toString("hex")
        : registry.defaultValue(key);
    await prisma.setting.create({
      data: { key, value: registry.serialize(key, value) },
    });
  }
}

async function main(): Promise<void> {
  const permIds = await seedPermissions();
  await seedRoles(permIds);
  await seedConfig();
  await seedInstitution();
  await seedAdminUser();
  await seedSettings();

  console.log("Seed complete (idempotent).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
