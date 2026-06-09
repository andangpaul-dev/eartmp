/**
 * Typed, versioned settings registry (architecture review F-25).
 *
 * Every known setting declares a key, a `schemaVersion`, a default, and a
 * validator. Values are stored as a JSON envelope `{ schemaVersion, value }`
 * and are validated on every read and write — nothing reads `Setting.value` as
 * untyped JSON. Validators are plain functions so the domain stays
 * framework-free (no Zod in the domain layer).
 */
import { SettingsError } from "../errors/config";
import type { StandingBand } from "../services/GpaEngine";

export interface SettingDefinition<T> {
  key: string;
  schemaVersion: number;
  default: T;
  description: string;
  /** Validate an untyped value, returning the typed value or throwing. */
  validate: (value: unknown) => T;
}

interface StoredEnvelope {
  schemaVersion: number;
  value: unknown;
}

export interface SettingView {
  key: string;
  schemaVersion: number;
  value: unknown;
  isDefault: boolean;
  description: string;
}

export class SettingsRegistry {
  private readonly defs = new Map<string, SettingDefinition<unknown>>();

  register<T>(def: SettingDefinition<T>): this {
    if (this.defs.has(def.key)) {
      throw new SettingsError(`Setting "${def.key}" is already registered.`);
    }
    this.defs.set(def.key, def as SettingDefinition<unknown>);
    return this;
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  keys(): string[] {
    return [...this.defs.keys()];
  }

  private def(key: string): SettingDefinition<unknown> {
    const def = this.defs.get(key);
    if (!def) throw new SettingsError(`Unknown setting "${key}".`);
    return def;
  }

  defaultValue(key: string): unknown {
    return this.def(key).default;
  }

  schemaVersion(key: string): number {
    return this.def(key).schemaVersion;
  }

  description(key: string): string {
    return this.def(key).description;
  }

  /** Validate a value against its definition; throws SettingsError if invalid. */
  validate(key: string, value: unknown): unknown {
    return this.def(key).validate(value);
  }

  /** Validate then serialize to the stored JSON envelope. */
  serialize(key: string, value: unknown): string {
    const def = this.def(key);
    const validated = def.validate(value);
    const envelope: StoredEnvelope = {
      schemaVersion: def.schemaVersion,
      value: validated,
    };
    return JSON.stringify(envelope);
  }

  /** Parse a stored envelope and validate; returns the typed value. */
  deserialize(key: string, raw: string): unknown {
    const def = this.def(key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SettingsError(`Setting "${key}" has corrupt JSON.`);
    }
    const envelope = parsed as Partial<StoredEnvelope>;
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.schemaVersion !== "number"
    ) {
      throw new SettingsError(`Setting "${key}" envelope is malformed.`);
    }
    // Future: migrate when envelope.schemaVersion < def.schemaVersion.
    return def.validate(envelope.value);
  }
}

// --- small validation helpers (domain-local, no framework) ----------------

function asObject(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SettingsError(`Setting "${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new SettingsError(`Setting "${key}" must be a string.`);
  }
  return value;
}

function asPositiveInt(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new SettingsError(`Setting "${key}" must be a positive integer.`);
  }
  return value;
}

function asBool(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new SettingsError(`Setting "${key}" must be a boolean.`);
  }
  return value;
}

function asFiniteNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SettingsError(`Setting "${key}" must be a finite number.`);
  }
  return value;
}

function asArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SettingsError(`Setting "${key}" must be an array.`);
  }
  return value;
}

// --- setting types --------------------------------------------------------

export interface PasswordPolicy {
  minLength: number;
  requireNumber: boolean;
  requireUppercase: boolean;
}

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const SETTING_KEYS = {
  passwordPolicy: "security.passwordPolicy",
  argon2Params: "security.argon2Params",
  defaultScaleName: "grading.defaultScaleName",
  standingBands: "grading.standingBands",
  transcriptNumberRule: "transcript.numberRule",
  encryptionSalt: "institution.encryptionSalt",
} as const;

/** Build the registry with all known settings (the institution's defaults). */
export function buildDefaultRegistry(): SettingsRegistry {
  const r = new SettingsRegistry();

  r.register<PasswordPolicy>({
    key: SETTING_KEYS.passwordPolicy,
    schemaVersion: 1,
    description: "Password complexity policy.",
    default: { minLength: 10, requireNumber: true, requireUppercase: true },
    validate: (v) => {
      const o = asObject(v, SETTING_KEYS.passwordPolicy);
      const minLength = asPositiveInt(o.minLength, "passwordPolicy.minLength");
      if (minLength < 8) {
        throw new SettingsError("passwordPolicy.minLength must be at least 8.");
      }
      return {
        minLength,
        requireNumber: asBool(o.requireNumber, "passwordPolicy.requireNumber"),
        requireUppercase: asBool(
          o.requireUppercase,
          "passwordPolicy.requireUppercase",
        ),
      };
    },
  });

  r.register<Argon2Params>({
    key: SETTING_KEYS.argon2Params,
    schemaVersion: 1,
    description: "Argon2id cost parameters.",
    default: { memoryCost: 19456, timeCost: 3, parallelism: 1 },
    validate: (v) => {
      const o = asObject(v, SETTING_KEYS.argon2Params);
      return {
        memoryCost: asPositiveInt(o.memoryCost, "argon2.memoryCost"),
        timeCost: asPositiveInt(o.timeCost, "argon2.timeCost"),
        parallelism: asPositiveInt(o.parallelism, "argon2.parallelism"),
      };
    },
  });

  r.register<string>({
    key: SETTING_KEYS.defaultScaleName,
    schemaVersion: 1,
    description: "Name of the default GradeScale.",
    default: "Default 5-Point Scale",
    validate: (v) => asString(v, SETTING_KEYS.defaultScaleName),
  });

  r.register<StandingBand[]>({
    key: SETTING_KEYS.standingBands,
    schemaVersion: 1,
    description: "Academic standing/classification bands (label + minGpa).",
    // `[ASSUMPTION]` placeholder classification — confirm per institution.
    default: [
      { label: "First Class", minGpa: 3.5 },
      { label: "Second Class Upper", minGpa: 3.0 },
      { label: "Second Class Lower", minGpa: 2.0 },
      { label: "Pass", minGpa: 1.0 },
      { label: "Fail", minGpa: 0 },
    ],
    validate: (v) => {
      const arr = asArray(v, SETTING_KEYS.standingBands);
      if (arr.length === 0) {
        throw new SettingsError("standingBands must have at least one band.");
      }
      return arr.map((entry, i) => {
        const o = asObject(entry, `standingBands[${i}]`);
        const label = asString(o.label, `standingBands[${i}].label`);
        const minGpa = asFiniteNumber(o.minGpa, `standingBands[${i}].minGpa`);
        if (label.length === 0) {
          throw new SettingsError(`standingBands[${i}].label is empty.`);
        }
        return { label, minGpa };
      });
    },
  });

  r.register<string>({
    key: SETTING_KEYS.transcriptNumberRule,
    schemaVersion: 1,
    description: "Format rule for transcript numbers.",
    default: "TR-{year}-{seq:000000}",
    validate: (v) => asString(v, SETTING_KEYS.transcriptNumberRule),
  });

  r.register<string>({
    key: SETTING_KEYS.encryptionSalt,
    schemaVersion: 1,
    description:
      "Salt for DB-at-rest key derivation (ADR-008). The KEY is never stored.",
    default: "",
    validate: (v) => asString(v, SETTING_KEYS.encryptionSalt),
  });

  return r;
}
