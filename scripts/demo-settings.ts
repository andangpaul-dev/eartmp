/**
 * Runnable settings/institution demo (DEV-ONLY). Wires the Phase 3 use-cases to
 * the Prisma dev repositories against the seeded `dev.db`. Demonstrates: reading
 * a setting, a validated write, a rejected invalid write, and the fail-closed
 * authorization seam.
 *
 * Run: npm run db:seed && npm run demo:settings
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import {
  PrismaInstitutionRepository,
  PrismaSettingRepository,
} from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../src/domain/settings/SettingsRegistry";
import {
  GetSetting,
  SetSetting,
  ListSettings,
} from "../src/application/use-cases/config/ManageSettings";
import { UpdateInstitution } from "../src/application/use-cases/config/ManageInstitution";
import { authorize } from "../src/application/authorization/AuthorizedUseCase";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

async function main(): Promise<void> {
  const db = getPrisma();
  const settingsRepo = new PrismaSettingRepository(db);
  const instRepo = new PrismaInstitutionRepository(db);
  const audit = new PrismaAuditLogAdapter(db);
  const registry = buildDefaultRegistry();

  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "settings.read",
    "settings.manage",
    "institution.manage",
  ]);
  const viewer = SessionContext.create("v", "VIEWER", ["settings.read"]);

  const get = new GetSetting(settingsRepo, registry);
  const set = new SetSetting(settingsRepo, registry, audit);
  const list = new ListSettings(settingsRepo, registry);
  const updateInst = new UpdateInstitution(instRepo, audit);

  console.log("1) Read password policy:");
  console.log(
    "   ",
    await authorize(get, { key: SETTING_KEYS.passwordPolicy }, admin),
  );

  console.log("2) Update default scale name (validated write):");
  await authorize(
    set,
    { key: SETTING_KEYS.defaultScaleName, value: "Honours 4-Point" },
    admin,
  );
  console.log(
    "   now:",
    await authorize(get, { key: SETTING_KEYS.defaultScaleName }, admin),
  );

  console.log("3) Reject an invalid argon2 params write:");
  try {
    await authorize(
      set,
      { key: SETTING_KEYS.argon2Params, value: { memoryCost: -1 } },
      admin,
    );
    console.log("   ✗ unexpectedly accepted");
  } catch (e) {
    console.log(`   ✓ rejected as ${(e as Error).name}`);
  }

  console.log("4) Fail-closed: VIEWER cannot write settings:");
  try {
    await authorize(
      set,
      { key: SETTING_KEYS.defaultScaleName, value: "x" },
      viewer,
    );
    console.log("   ✗ unexpectedly allowed");
  } catch (e) {
    console.log(`   ✓ denied as ${(e as Error).name}`);
  }

  console.log("5) Update institution motto:");
  const inst = await authorize(
    updateInst,
    { patch: { motto: "Ad astra" } },
    admin,
  );
  console.log(`   institution "${inst.name}" motto = "${inst.motto}"`);

  console.log("6) All settings:");
  for (const v of await authorize(list, {}, admin)) {
    console.log(
      `   - ${v.key} (v${v.schemaVersion}${v.isDefault ? ", default" : ""})`,
    );
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
