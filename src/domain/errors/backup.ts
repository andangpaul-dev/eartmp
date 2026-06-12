/**
 * Backup domain error (integrity, format, restore).
 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}
