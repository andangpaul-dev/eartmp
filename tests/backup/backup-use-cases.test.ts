import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateBackup,
  RestoreBackup,
} from "../../src/application/use-cases/backup/Backup";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { BackupCipher } from "../../src/infrastructure/crypto/BackupCipher";
import { Argon2KeyDerivationService } from "../../src/infrastructure/crypto/Argon2KeyDerivationService";
import { BackupError } from "../../src/domain/errors/backup";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type { DataExportPort } from "../../src/application/ports/DataExportPort";
import type { DatabaseSnapshot } from "../../src/domain/services/Backup";
import type { ClockPort } from "../../src/application/ports/ClockPort";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "backup.create",
  "backup.restore",
]);
const clock: ClockPort = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const PASS = "operator passphrase";

class FakeExport implements DataExportPort {
  snapshot: DatabaseSnapshot = {
    user: [{ id: "u1", username: "admin" }],
    setting: [{ key: "k", value: "v" }],
  };
  imported: DatabaseSnapshot | null = null;
  async exportAll() {
    return this.snapshot;
  }
  async importAll(s: DatabaseSnapshot) {
    this.imported = s;
  }
}

let exporter: FakeExport;
let cipher: BackupCipher;
let audit: CapturingAudit;
let create: CreateBackup;
let restore: RestoreBackup;
beforeEach(() => {
  exporter = new FakeExport();
  cipher = new BackupCipher(new Argon2KeyDerivationService());
  audit = new CapturingAudit();
  create = new CreateBackup(exporter, cipher, clock, audit);
  restore = new RestoreBackup(exporter, cipher, audit);
});

describe("CreateBackup → RestoreBackup", () => {
  it("round-trips: restore imports the same snapshot", async () => {
    const env = await create.execute({ passphrase: PASS }, admin);
    expect(env.manifest.tables).toMatchObject({ user: 1, setting: 1 });

    const result = await restore.execute(
      { envelope: env, passphrase: PASS },
      admin,
    );
    expect(result.rows).toBe(2);
    expect(exporter.imported).toEqual(exporter.snapshot);
  }, 30000);

  it("rejects a tampered ciphertext and does not import", async () => {
    const env = await create.execute({ passphrase: PASS }, admin);
    const i = Math.floor(env.ciphertext.length / 2);
    const bad = {
      ...env,
      ciphertext:
        env.ciphertext.slice(0, i) +
        (env.ciphertext[i] === "A" ? "B" : "A") +
        env.ciphertext.slice(i + 1),
    };
    await expect(
      restore.execute({ envelope: bad, passphrase: PASS }, admin),
    ).rejects.toBeInstanceOf(BackupError);
    expect(exporter.imported).toBeNull();
  }, 30000);

  it("rejects the wrong passphrase", async () => {
    const env = await create.execute({ passphrase: PASS }, admin);
    await expect(
      restore.execute({ envelope: env, passphrase: "nope" }, admin),
    ).rejects.toBeInstanceOf(BackupError);
    expect(exporter.imported).toBeNull();
  }, 30000);

  it("rejects a checksum mismatch (decrypts but content altered)", async () => {
    const env = await create.execute({ passphrase: PASS }, admin);
    const bad = {
      ...env,
      manifest: { ...env.manifest, checksum: "deadbeef" },
    };
    await expect(
      restore.execute({ envelope: bad, passphrase: PASS }, admin),
    ).rejects.toThrow(/checksum/);
  }, 30000);

  it("rejects an unsupported format version", async () => {
    const env = await create.execute({ passphrase: PASS }, admin);
    const bad = { ...env, manifest: { ...env.manifest, formatVersion: 99 } };
    await expect(
      restore.execute({ envelope: bad, passphrase: PASS }, admin),
    ).rejects.toThrow(/format/);
  }, 30000);
});

describe("authorization", () => {
  it("CreateBackup requires backup.create", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["backup.restore"]);
    await expect(
      authorize(create, { passphrase: PASS }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("RestoreBackup requires backup.restore", () => {
    expect(restore.requiredPermissions).toEqual(["backup.restore"]);
  });
});
