/**
 * Backup use-cases (Phase 17). `CreateBackup` exports the dataset, checksums it,
 * and encrypts it into an envelope. `RestoreBackup` is VERIFY-FIRST (AD17.3):
 * decrypt (GCM-authenticated) → checksum-verify → atomic `importAll`. Any
 * integrity failure or wrong passphrase aborts with zero writes. Both gated +
 * audited.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { BackupError } from "../../../domain/errors/backup";
import {
  BACKUP_FORMAT_VERSION,
  type BackupEnvelope,
  type DatabaseSnapshot,
} from "../../../domain/services/Backup";
import type { DataExportPort } from "../../ports/DataExportPort";
import type { BackupCipherPort } from "../../ports/BackupCipherPort";
import type { ClockPort } from "../../ports/ClockPort";
import type { AuditLogPort } from "../../../domain/repositories";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

function countRows(snapshot: DatabaseSnapshot): Record<string, number> {
  return Object.fromEntries(
    Object.entries(snapshot).map(([t, rows]) => [t, rows.length]),
  );
}

export interface CreateBackupInput {
  passphrase: string;
}
export class CreateBackup implements AuthorizedUseCase<
  CreateBackupInput,
  BackupEnvelope
> {
  readonly name = "CreateBackup";
  readonly requiredPermissions = ["backup.create"];

  constructor(
    private readonly exporter: DataExportPort,
    private readonly cipher: BackupCipherPort,
    private readonly clock: ClockPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: CreateBackupInput,
    session: SessionContext,
  ): Promise<BackupEnvelope> {
    const snapshot = await this.exporter.exportAll();
    const plaintext = JSON.stringify(snapshot);
    const checksum = this.cipher.checksum(plaintext);
    const enc = await this.cipher.encrypt(plaintext, input.passphrase);
    const tables = countRows(snapshot);

    const envelope: BackupEnvelope = {
      manifest: {
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: this.clock.now().toISOString(),
        salt: enc.salt,
        iv: enc.iv,
        authTag: enc.authTag,
        checksum,
        tables,
      },
      ciphertext: enc.ciphertext,
    };

    await this.audit.record({
      userId: session.actorId,
      action: "BACKUP",
      entity: "Database",
      newValue: { tables },
    });
    return envelope;
  }
}

export interface RestoreBackupInput {
  envelope: BackupEnvelope;
  passphrase: string;
}
export interface RestoreResult {
  tables: number;
  rows: number;
}
export class RestoreBackup implements AuthorizedUseCase<
  RestoreBackupInput,
  RestoreResult
> {
  readonly name = "RestoreBackup";
  readonly requiredPermissions = ["backup.restore"];

  constructor(
    private readonly exporter: DataExportPort,
    private readonly cipher: BackupCipherPort,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(
    input: RestoreBackupInput,
    session: SessionContext,
  ): Promise<RestoreResult> {
    const m = input.envelope.manifest;
    if (m.formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BackupError(
        `Unsupported backup format v${m.formatVersion} (expected v${BACKUP_FORMAT_VERSION}).`,
      );
    }

    let plaintext: string;
    try {
      plaintext = await this.cipher.decrypt(
        input.envelope.ciphertext,
        input.passphrase,
        { salt: m.salt, iv: m.iv, authTag: m.authTag },
      );
    } catch {
      throw new BackupError(
        "Backup failed to decrypt — it is tampered or the passphrase is wrong.",
      );
    }

    if (this.cipher.checksum(plaintext) !== m.checksum) {
      throw new BackupError(
        "Backup integrity check failed (checksum mismatch).",
      );
    }

    const snapshot = JSON.parse(plaintext) as DatabaseSnapshot;
    await this.exporter.importAll(snapshot); // atomic (AD17.3)

    const rows = Object.values(snapshot).reduce((s, r) => s + r.length, 0);
    await this.audit.record({
      userId: session.actorId,
      action: "RESTORE",
      entity: "Database",
      newValue: { tables: Object.keys(snapshot).length, rows },
    });
    return { tables: Object.keys(snapshot).length, rows };
  }
}
