/**
 * Configuration domain errors (settings + institution).
 */

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export class InstitutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstitutionError";
  }
}
