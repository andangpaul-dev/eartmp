/**
 * Per-institution transcript-signing key storage (Phase F).
 *
 * The default deployment keeps ONE signing keypair in two registry settings
 * (`transcript.signingPublicKey` / `transcript.signingPrivateKey`). An
 * institution MAY instead own a dedicated keypair, stored under namespaced
 * setting rows `…:<institutionId>` holding the raw PEM / sealed string (no
 * registry envelope — the values are opaque). When an institution has no
 * dedicated key it FALLS BACK to the global key, so single-institution and
 * legacy deployments are unchanged.
 *
 * These helpers are the single source of truth for the naming + fallback rules,
 * shared by the key provider and the provision/rotate use-cases. Pure data
 * access over the SettingRepository — no crypto here.
 */
import type { SettingRepository } from "../repositories/config";
import { SETTING_KEYS, type SettingsRegistry } from "./SettingsRegistry";

const PUB = SETTING_KEYS.transcriptPublicKey;
const PRIV = SETTING_KEYS.transcriptPrivateKey;

/** The namespaced setting key for an institution's own asset (raw storage). */
export function namespacedKey(base: string, institutionId: string): string {
  return `${base}:${institutionId}`;
}

async function readGlobal(
  settings: SettingRepository,
  registry: SettingsRegistry,
  base: string,
): Promise<string> {
  const raw = await settings.getRaw(base);
  const value =
    raw === null
      ? registry.defaultValue(base)
      : registry.deserialize(base, raw);
  return typeof value === "string" ? value : "";
}

/** True only if THIS institution owns a dedicated key (ignores the fallback). */
export async function hasOwnSigningKey(
  settings: SettingRepository,
  institutionId: string,
): Promise<boolean> {
  const ns = await settings.getRaw(namespacedKey(PUB, institutionId));
  return typeof ns === "string" && ns.length > 0;
}

/** Public PEM for an institution: its own if provisioned, else the global key. */
export async function resolveSigningPublic(
  settings: SettingRepository,
  registry: SettingsRegistry,
  institutionId?: string,
): Promise<string> {
  if (institutionId) {
    const ns = await settings.getRaw(namespacedKey(PUB, institutionId));
    if (ns) return ns;
  }
  return readGlobal(settings, registry, PUB);
}

/** Sealed private for an institution: its own if provisioned, else the global. */
export async function resolveSigningPrivate(
  settings: SettingRepository,
  registry: SettingsRegistry,
  institutionId?: string,
): Promise<string> {
  if (institutionId) {
    const ns = await settings.getRaw(namespacedKey(PRIV, institutionId));
    if (ns) return ns;
  }
  return readGlobal(settings, registry, PRIV);
}

/**
 * Persist a keypair. With an institutionId the values are stored raw under the
 * namespaced rows; without one they go through the registry envelope into the
 * shared global setting (legacy behaviour).
 */
export async function writeSigningKeys(
  settings: SettingRepository,
  registry: SettingsRegistry,
  institutionId: string | undefined,
  publicPem: string,
  sealedPrivate: string,
): Promise<void> {
  if (institutionId) {
    await settings.setRaw(namespacedKey(PUB, institutionId), publicPem);
    await settings.setRaw(namespacedKey(PRIV, institutionId), sealedPrivate);
  } else {
    await settings.setRaw(PUB, registry.serialize(PUB, publicPem));
    await settings.setRaw(PRIV, registry.serialize(PRIV, sealedPrivate));
  }
}

/** Read the raw sealed private for an institution's OWN key (no fallback). */
export async function readOwnSealedPrivate(
  settings: SettingRepository,
  institutionId: string,
): Promise<string | null> {
  return settings.getRaw(namespacedKey(PRIV, institutionId));
}
