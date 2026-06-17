/**
 * AssetStorePort — persists institution branding images (logo / seal / registrar
 * signature) and returns the stored path. Keeps file I/O out of the application
 * layer; the infrastructure impl writes under the per-user app-data dir.
 */
export type BrandingAssetKind = "logo" | "seal" | "registrarSign";

export interface AssetStorePort {
  /** Save the bytes for an institution's asset; returns the stored file path. */
  save(
    institutionId: string,
    kind: BrandingAssetKind,
    bytes: Uint8Array,
    ext: string,
  ): Promise<string>;
}
