/**
 * Reusable database seed — the minimum configuration every install needs:
 * RBAC catalog, a default grade scale + assessment config, the transcript
 * template, the singleton institution, the default admin user, and validated
 * settings (encryption salt + sealed signing keypair). Idempotent: every write
 * is keyed on a unique/stable field, so re-seeding never duplicates.
 *
 * Called by the CLI seed (`prisma/seed.ts`, `npm run db:seed`) and by the host
 * first-launch bootstrap (`bootstrap.ts`) in the packaged app.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { Argon2HashingService } from "../crypto/Argon2HashingService";
import { Argon2KeyDerivationService } from "../crypto/Argon2KeyDerivationService";
import { CryptoSignatureService } from "../crypto/CryptoSignatureService";
import { SecretBox } from "../crypto/SecretBox";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../domain/settings/SettingsRegistry";

const INSTITUTION_ID = "seed-institution-001";

export const DEFAULT_ADMIN = {
  username: "admin",
  email: "admin@example.edu",
  fullName: "System Administrator",
  password: "ChangeMe123!",
};

export const PERMISSIONS: { key: string; label: string }[] = [
  { key: "students.read", label: "View students" },
  { key: "students.create", label: "Create students" },
  { key: "students.update", label: "Edit students" },
  { key: "students.manage", label: "Merge & bulk-manage students" },
  { key: "results.read", label: "View results" },
  { key: "results.import", label: "Import results" },
  { key: "results.process", label: "Process results" },
  { key: "results.unlock", label: "Unlock locked results" },
  { key: "results.override", label: "Override locked/published results" },
  { key: "transcripts.read", label: "View/verify transcripts" },
  { key: "transcripts.generate", label: "Generate transcripts" },
  { key: "transcripts.approve", label: "Approve transcripts" },
  { key: "templates.read", label: "View transcript templates" },
  { key: "templates.manage", label: "Manage transcript templates" },
  { key: "graduation.read", label: "Evaluate graduation eligibility" },
  { key: "graduation.clear", label: "Clear students for graduation" },
  { key: "config.read", label: "View grading/assessment config" },
  { key: "config.manage", label: "Manage grading/assessment config" },
  { key: "backup.create", label: "Create backups" },
  { key: "backup.restore", label: "Restore backups" },
  { key: "security.manage", label: "Manage security (key passphrase)" },
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
  { key: "courses.read", label: "View courses" },
  { key: "courses.create", label: "Create courses" },
  { key: "courses.update", label: "Edit/delete courses" },
];

export const ROLES: {
  name: string;
  description: string;
  permissions: string[];
}[] = [
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
      "results.read",
      "results.process",
      "results.unlock",
      "transcripts.read",
      "transcripts.generate",
      "transcripts.approve",
      "templates.read",
      "templates.manage",
      "graduation.read",
      "graduation.clear",
      "audit.read",
      "settings.read",
      "structure.read",
      "structure.manage",
      "courses.read",
      "courses.create",
      "courses.update",
      "config.read",
    ],
  },
  {
    name: "DATA_ENTRY",
    description: "Enter/import results, no approvals",
    permissions: [
      "students.read",
      "results.read",
      "results.import",
      "results.process",
      "courses.read",
    ],
  },
  {
    name: "FACULTY_OFFICER",
    description: "Academic records for assigned faculties only",
    permissions: [
      "students.read",
      "results.read",
      "results.import",
      "results.process",
      "transcripts.read",
      "transcripts.generate",
      "courses.read",
      "graduation.read",
    ],
  },
  {
    name: "VIEWER",
    description: "Read-only",
    permissions: ["students.read", "audit.read"],
  },
];

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

// A bundled degree-certificate layout (CERTIFICATE category). Uses lenient
// `template` interpolation for student fields so it never fails to generate;
// `bind` for fields the report always carries (number, date, QR).
const CERTIFICATE_LAYOUT_V1 = {
  schemaVersion: 1,
  pageSize: "A4",
  blocks: [
    { type: "title", value: "CERTIFICATE OF AWARD" },
    { type: "text", template: "This is to certify that" },
    { type: "text", template: "{{student.fullName}}" },
    {
      type: "text",
      template:
        "having satisfied all the requirements prescribed by {{institution.name}}, has been awarded the degree of",
    },
    { type: "text", template: "{{student.programme}}" },
    {
      type: "fieldGrid",
      columns: 2,
      fields: [
        { label: "Class / Division", template: "{{summary.standing}}" },
        { label: "Faculty", template: "{{student.faculty}}" },
        { label: "Certificate No.", bind: "verification.transcriptNumber" },
        { label: "Date of issue", bind: "issuedAt" },
      ],
    },
    { type: "remarks", value: "Given under the seal of the institution." },
    { type: "signatureRow" },
    { type: "qr", bind: "verification.qrPayload" },
  ],
};

async function seedPermissions(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
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

async function seedRoles(
  prisma: PrismaClient,
  permIds: Map<string, string>,
): Promise<void> {
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

async function seedConfig(prisma: PrismaClient): Promise<void> {
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

async function seedInstitution(prisma: PrismaClient): Promise<void> {
  await prisma.institution.upsert({
    where: { id: INSTITUTION_ID },
    update: {},
    create: {
      id: INSTITUTION_ID,
      name: "Example University",
      code: "EXU",
      isDefault: true,
      calendarType: "SEMESTER",
    },
  });
}

async function seedAdminUser(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username: DEFAULT_ADMIN.username },
  });
  if (existing) return; // never rewrite an existing admin password

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

async function seedSettings(prisma: PrismaClient): Promise<void> {
  const registry = buildDefaultRegistry();
  const keypair = CryptoSignatureService.generateKeypair();
  const box = new SecretBox(new Argon2KeyDerivationService());
  const bootstrapPassphrase =
    process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase";
  for (const key of registry.keys()) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (existing) continue;
    let value: unknown = registry.defaultValue(key);
    if (key === SETTING_KEYS.encryptionSalt)
      value = randomBytes(16).toString("hex");
    else if (key === SETTING_KEYS.transcriptPublicKey)
      value = keypair.publicKeyPem;
    else if (key === SETTING_KEYS.transcriptPrivateKey)
      value = await box.seal(keypair.privateKeyPem, bootstrapPassphrase);
    await prisma.setting.create({
      data: { key, value: registry.serialize(key, value) },
    });
  }
}

/** Provision the default install configuration. Idempotent. */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const permIds = await seedPermissions(prisma);
  await seedRoles(prisma, permIds);
  await seedConfig(prisma);
  await seedInstitution(prisma);
  await seedAdminUser(prisma);
  await seedSettings(prisma);
}

/**
 * Built-in document templates, refreshed on every launch (idempotent, keyed by
 * name) so an ALREADY-provisioned database also gains newly-shipped templates —
 * e.g. the degree certificate. The default per category is set only on first
 * creation, so an admin's later choice of default is preserved.
 */
/**
 * Built-in permissions + roles, refreshed on every launch (idempotent upserts)
 * so an existing database gains newly-shipped permissions/roles — e.g. the
 * FACULTY_OFFICER role — without a re-provision.
 */
export async function ensureBuiltinRoles(prisma: PrismaClient): Promise<void> {
  const permIds = await seedPermissions(prisma);
  await seedRoles(prisma, permIds);
}

export async function ensureBuiltinTemplates(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.transcriptTemplate.upsert({
    where: { name: "Degree Certificate" },
    update: {
      layout: JSON.stringify(CERTIFICATE_LAYOUT_V1),
      version: 1,
      category: "CERTIFICATE",
    },
    create: {
      name: "Degree Certificate",
      version: 1,
      layout: JSON.stringify(CERTIFICATE_LAYOUT_V1),
      isDefault: true,
      category: "CERTIFICATE",
    },
  });
}
