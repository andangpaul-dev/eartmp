/**
 * Runnable security demo (DEV-ONLY). Seals/opens a secret, opens the SEALED
 * transcript signing key to sign + verify, shows a wrong passphrase failing, and
 * changes the key passphrase (re-seal) — then changes it back so the demo is
 * repeatable. Run: npm run db:seed && npm run demo:security
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaSettingRepository } from "../src/infrastructure/repositories/PrismaConfigRepositories";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import { SecretBox } from "../src/infrastructure/crypto/SecretBox";
import { Argon2KeyDerivationService } from "../src/infrastructure/crypto/Argon2KeyDerivationService";
import { SealedSigningKeyProvider } from "../src/infrastructure/crypto/SealedSigningKeyProvider";
import { ChangeKeyPassphrase } from "../src/application/use-cases/security/ChangeKeyPassphrase";
import { buildDefaultRegistry } from "../src/domain/settings/SettingsRegistry";
import { SessionContext } from "../src/domain/value-objects/SessionContext";

const PASS = process.env.EARTMP_KEY_PASSPHRASE ?? "eartmp-dev-passphrase";

async function main(): Promise<void> {
  const db = getPrisma();
  const settings = new PrismaSettingRepository(db);
  const registry = buildDefaultRegistry();
  const box = new SecretBox(new Argon2KeyDerivationService());
  const audit = new PrismaAuditLogAdapter(db);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "security.manage",
  ]);

  console.log("1) Seal/open a secret:");
  const sealed = await box.seal("top-secret value", PASS);
  const opened = await box.open(sealed, PASS);
  console.log(
    `   round-trip ok=${opened === "top-secret value"}; sealed looks like a blob=${box.isSealed(sealed)}`,
  );

  console.log("2) Open the SEALED signing key and sign + verify:");
  const provider = new SealedSigningKeyProvider(settings, registry, box);
  const signer = await provider.getSigner(PASS);
  const sig = signer.sign("hello");
  console.log(`   signed + verified=${signer.verify("hello", sig.signature)}`);

  console.log("3) Wrong passphrase cannot open the key:");
  try {
    await provider.getSigner("wrong-passphrase");
    console.log("   ✗ opened with the wrong passphrase (BAD)");
  } catch (e) {
    console.log(`   ✓ ${(e as Error).message}`);
  }

  console.log("4) Change the key passphrase (re-seal), then change back:");
  const change = new ChangeKeyPassphrase(settings, registry, box, audit);
  await change.execute(
    { oldPassphrase: PASS, newPassphrase: "new-passphrase" },
    admin,
  );
  const signer2 = await provider.getSigner("new-passphrase");
  console.log(
    `   re-sealed; signs under new passphrase=${signer2.verify("x", signer2.sign("x").signature)}`,
  );
  try {
    await provider.getSigner(PASS);
    console.log("   ✗ old passphrase still works (BAD)");
  } catch {
    console.log("   ✓ old passphrase no longer opens the key");
  }
  // Restore the bootstrap passphrase so the demo is repeatable.
  await change.execute(
    { oldPassphrase: "new-passphrase", newPassphrase: PASS },
    admin,
  );
  console.log("   ✓ restored the bootstrap passphrase");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
