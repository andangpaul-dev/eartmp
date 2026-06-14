/**
 * Configuration host smoke (Milestone 6). Drives the M6 config paths through the
 * host + gate exactly as the webview does, restoring all original state:
 *   institution: get → update (motto) → restore.
 *   settings:    getSetting/setSetting graduation.requirements → restore.
 *   grading:     listGradeScales/listAssessmentConfigs → setDefault (idempotent).
 *   security:    changeKeyPassphrase (PASS→PASS2), proven by unseal with the new
 *                passphrase and refusal of the old, then rotated back → seal.
 * Needs the seed (institution + grading config + sealed keypair).
 * Run: npm run db:seed && tsx scripts/host-smoke-config.ts
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { buildHost } from "../src/host/composition";
import { createCore } from "../src/host/dispatcher";

const PASS = process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase";
const PASS2 = "rotated-smoke-passphrase";
const GRAD_KEY = "graduation.requirements";

async function main(): Promise<void> {
  const db = getPrisma();
  const core = createCore(buildHost(db));
  const { token } = await core.login({
    username: "admin",
    password: "ChangeMe123!",
  });

  let ok = true;
  const check = (label: string, pass: boolean, extra = ""): void => {
    ok = ok && pass;
    console.log(`   ${pass ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  };

  console.log("1) getInstitution:");
  const inst = await core.dispatch("getInstitution", {}, token);
  const original = inst.ok
    ? (inst.data as { name: string; motto?: string })
    : null;
  check(
    "loaded",
    inst.ok,
    original ? original.name : inst.ok ? "" : inst.error.code,
  );

  console.log("2) updateInstitution (motto) then restore:");
  const upd = await core.dispatch(
    "updateInstitution",
    { patch: { motto: "Knowledge & Service (smoke)" } },
    token,
  );
  check(
    "updated",
    upd.ok &&
      (upd.data as { motto?: string }).motto === "Knowledge & Service (smoke)",
  );
  await core.dispatch(
    "updateInstitution",
    { patch: { motto: original?.motto ?? "" } },
    token,
  );

  console.log("3) getSetting graduation.requirements:");
  const g = await core.dispatch("getSetting", { key: GRAD_KEY }, token);
  const grad = g.ok ? (g.data as { minCgpa: number }) : null;
  check(
    "read",
    g.ok && typeof grad?.minCgpa === "number",
    grad ? `minCgpa ${grad.minCgpa}` : g.ok ? "" : g.error.code,
  );

  console.log("4) setSetting graduation.requirements then restore:");
  const set = await core.dispatch(
    "setSetting",
    { key: GRAD_KEY, value: { ...grad, minCgpa: 2.5 } },
    token,
  );
  const reread = await core.dispatch("getSetting", { key: GRAD_KEY }, token);
  check(
    "written",
    set.ok && reread.ok && (reread.data as { minCgpa: number }).minCgpa === 2.5,
  );
  await core.dispatch("setSetting", { key: GRAD_KEY, value: grad }, token);

  console.log("5) listGradeScales:");
  const scales = await core.dispatch("listGradeScales", {}, token);
  const scaleList = scales.ok
    ? (scales.data as { id: string; isDefault: boolean }[])
    : [];
  check(
    "listed with a default",
    scaleList.length > 0 && scaleList.some((s) => s.isDefault),
    `${scaleList.length} scales`,
  );

  console.log("6) setDefaultGradeScale (idempotent on current default):");
  const defScale = scaleList.find((s) => s.isDefault);
  const sd = defScale
    ? await core.dispatch("setDefaultGradeScale", { id: defScale.id }, token)
    : scales;
  check("ok", sd.ok, sd.ok ? "" : sd.error.code);

  console.log("7) listAssessmentConfigs:");
  const configs = await core.dispatch("listAssessmentConfigs", {}, token);
  const cfgList = configs.ok
    ? (configs.data as { id: string; isDefault: boolean }[])
    : [];
  check(
    "listed with a default",
    cfgList.length > 0 && cfgList.some((c) => c.isDefault),
    `${cfgList.length} structures`,
  );

  console.log("8) setDefaultAssessmentConfig (idempotent):");
  const defCfg = cfgList.find((c) => c.isDefault);
  const cd = defCfg
    ? await core.dispatch(
        "setDefaultAssessmentConfig",
        { id: defCfg.id },
        token,
      )
    : configs;
  check("ok", cd.ok, cd.ok ? "" : cd.error.code);

  console.log("9) changeKeyPassphrase PASS → PASS2:");
  const rot = await core.dispatch(
    "changeKeyPassphrase",
    { oldPassphrase: PASS, newPassphrase: PASS2 },
    token,
  );
  check("rotated", rot.ok, rot.ok ? "" : rot.error.code);

  console.log("10) old passphrase no longer unseals:");
  const old = await core.dispatch("unsealKey", { passphrase: PASS }, token);
  check("refused", !old.ok, old.ok ? "ALLOWED (BAD)" : old.error.code);

  console.log("11) new passphrase unseals:");
  const neo = await core.dispatch("unsealKey", { passphrase: PASS2 }, token);
  check("unsealed", neo.ok && !(neo.data as { sealed: boolean }).sealed);

  console.log("12) rotate back PASS2 → PASS and seal:");
  const back = await core.dispatch(
    "changeKeyPassphrase",
    { oldPassphrase: PASS2, newPassphrase: PASS },
    token,
  );
  await core.dispatch("sealKey", {}, token);
  const restore = await core.dispatch("unsealKey", { passphrase: PASS }, token);
  check(
    "restored",
    back.ok && restore.ok && !(restore.data as { sealed: boolean }).sealed,
  );
  await core.dispatch("sealKey", {}, token);

  await db.$disconnect();
  console.log(`\nConfiguration host smoke: ${ok ? "GREEN ✅" : "RED ❌"}`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
