/**
 * Runnable backup demo (DEV-ONLY, NON-DESTRUCTIVE). Creates an encrypted backup
 * of dev.db, shows a tampered backup and a wrong passphrase being rejected, then
 * verifies the valid backup by decrypt + checksum WITHOUT importing (so dev.db is
 * never overwritten — the atomic importAll path is covered by unit tests).
 * Run: npm run db:seed && npm run demo:backup
 */
import { getPrisma } from "../src/infrastructure/db/prisma";
import { PrismaDataExport } from "../src/infrastructure/backup/PrismaDataExport";
import { BackupCipher } from "../src/infrastructure/crypto/BackupCipher";
import { Argon2KeyDerivationService } from "../src/infrastructure/crypto/Argon2KeyDerivationService";
import { PrismaAuditLogAdapter } from "../src/infrastructure/repositories/PrismaAuthRepositories";
import {
  CreateBackup,
  RestoreBackup,
} from "../src/application/use-cases/backup/Backup";
import { SessionContext } from "../src/domain/value-objects/SessionContext";
import type { ClockPort } from "../src/application/ports/ClockPort";
import type { DatabaseSnapshot } from "../src/domain/services/Backup";

const clock: ClockPort = { now: () => new Date() };
const PASS = "correct horse battery staple";

function flip(s: string): string {
  const i = Math.floor(s.length / 2);
  return s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
}

async function main(): Promise<void> {
  const db = getPrisma();
  const exporter = new PrismaDataExport(db);
  const cipher = new BackupCipher(new Argon2KeyDerivationService());
  const audit = new PrismaAuditLogAdapter(db);
  const create = new CreateBackup(exporter, cipher, clock, audit);
  const restore = new RestoreBackup(exporter, cipher, audit);
  const admin = SessionContext.create("admin", "SUPER_ADMIN", [
    "backup.create",
    "backup.restore",
  ]);

  console.log("1) Create an encrypted backup of dev.db:");
  const env = await create.execute({ passphrase: PASS }, admin);
  const totalRows = Object.values(env.manifest.tables).reduce(
    (s, n) => s + n,
    0,
  );
  console.log(
    `   ${Object.keys(env.manifest.tables).length} tables, ${totalRows} rows; checksum ${env.manifest.checksum.slice(0, 12)}…`,
  );

  console.log("2) Tampered backup is rejected (no import):");
  try {
    await restore.execute(
      {
        envelope: { ...env, ciphertext: flip(env.ciphertext) },
        passphrase: PASS,
      },
      admin,
    );
    console.log("   ✗ restored a tampered backup (BAD)");
  } catch (e) {
    console.log(`   ✓ ${(e as Error).message}`);
  }

  console.log("3) Wrong passphrase is rejected (no import):");
  try {
    await restore.execute({ envelope: env, passphrase: "wrong-pass" }, admin);
    console.log("   ✗ restored with the wrong passphrase (BAD)");
  } catch (e) {
    console.log(`   ✓ ${(e as Error).message}`);
  }

  console.log(
    "4) Valid backup verified (decrypt + checksum, non-destructive):",
  );
  const plaintext = await cipher.decrypt(env.ciphertext, PASS, {
    salt: env.manifest.salt,
    iv: env.manifest.iv,
    authTag: env.manifest.authTag,
  });
  const ok = cipher.checksum(plaintext) === env.manifest.checksum;
  const snap = JSON.parse(plaintext) as DatabaseSnapshot;
  const rows = Object.values(snap).reduce((s, r) => s + r.length, 0);
  console.log(`   checksum-ok=${ok}, decrypted ${rows} rows`);
  console.log(
    "   (atomic importAll is covered by unit tests; demo does not overwrite dev.db)",
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
