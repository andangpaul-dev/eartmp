/**
 * Runnable transcript-template management demo (DEV-ONLY). Create a valid
 * template, reject an invalid layout on save, edit (version bump), clone, set
 * default, guarded delete, and list. Cleans up. Run: npm run db:seed &&
 * npm run demo:template
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaTranscriptTemplateRepository } from "../src/infrastructure/repositories/PrismaTranscriptRepository";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  CreateTemplate,
  UpdateTemplate,
  CloneTemplate,
  SetDefaultTemplate,
  DeleteTemplate,
  ListTemplates,
} from "../src/application/use-cases/transcripts/ManageTemplates";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

const validLayout = {
  pageSize: "A4",
  blocks: [
    { type: "title", value: "ACADEMIC TRANSCRIPT" },
    {
      type: "fieldGrid",
      fields: [{ label: "Name", bind: "student.fullName" }],
    },
    { type: "summary", fields: [{ label: "CGPA", bind: "summary.cgpa" }] },
    { type: "qr", bind: "verification.qrPayload" },
  ],
};
const invalidLayout = {
  blocks: [
    { type: "fieldGrid", fields: [{ label: "X", bind: "student.nope" }] },
  ],
};

async function main(): Promise<void> {
  const db = getPrisma();
  const store = new PrismaTranscriptTemplateRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "templates.read",
    "templates.manage",
  ]);

  console.log("1) Create a valid template:");
  const created = await new CreateTemplate(store, audit).execute(
    { name: "DTpl Official", layout: validLayout },
    admin,
  );
  console.log(`   created "${created.name}" v${created.version}`);

  console.log("2) Invalid layout is rejected on save:");
  try {
    await new CreateTemplate(store, audit).execute(
      { name: "DTpl Bad", layout: invalidLayout },
      admin,
    );
    console.log("   ✗ accepted (BAD)");
  } catch (e) {
    console.log(`   ✓ rejected: ${(e as Error).message.slice(0, 60)}…`);
  }

  console.log("3) Edit bumps the version:");
  const updated = await new UpdateTemplate(store, audit).execute(
    { id: created.id, name: "DTpl Official v2" },
    admin,
  );
  console.log(`   now v${updated.version}`);

  console.log("4) Clone + set default:");
  const clone = await new CloneTemplate(store, audit).execute(
    { id: created.id, name: "DTpl Clone" },
    admin,
  );
  await new SetDefaultTemplate(store, audit).execute({ id: clone.id }, admin);
  console.log(`   cloned "${clone.name}", set as default`);

  console.log("5) Guarded delete (default cannot be deleted):");
  try {
    await new DeleteTemplate(store, audit).execute({ id: clone.id }, admin);
    console.log("   ✗ deleted the default (BAD)");
  } catch (e) {
    console.log(`   ✓ rejected: ${(e as Error).message}`);
  }
  await new DeleteTemplate(store, audit).execute({ id: created.id }, admin);
  console.log("   ✓ non-default deleted");

  console.log("6) List (DTpl only):");
  const list = (await new ListTemplates(store).execute({}, admin)).filter((t) =>
    t.name.startsWith("DTpl"),
  );
  console.log(
    `   ${list.map((t) => `${t.name}${t.isDefault ? "*" : ""}`).join(", ")}`,
  );

  console.log("7) Cleanup:");
  await db.transcriptTemplate.deleteMany({
    where: { name: { startsWith: "DTpl" } },
  });
  console.log("   ✓ cleaned up");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
