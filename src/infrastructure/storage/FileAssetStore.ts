/**
 * FileAssetStore — writes institution branding images under a base directory
 * (the per-user app-data `branding/` dir). One file per (institution, kind);
 * re-uploading replaces it. Stale variants with a different extension are
 * removed so only the latest asset of each kind remains.
 */
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type {
  AssetStorePort,
  BrandingAssetKind,
} from "../../application/ports/AssetStorePort";

export class FileAssetStore implements AssetStorePort {
  constructor(private readonly baseDir: string) {}

  async save(
    institutionId: string,
    kind: BrandingAssetKind,
    bytes: Uint8Array,
    ext: string,
  ): Promise<string> {
    const dir = join(this.baseDir, institutionId);
    mkdirSync(dir, { recursive: true });
    const safeExt =
      ext
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase()
        .slice(0, 5) || "png";
    // Drop any previous variant of this kind (e.g. logo.jpg when saving logo.png).
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f === `${kind}.${safeExt}`) continue;
        if (f.startsWith(`${kind}.`)) {
          try {
            rmSync(join(dir, f), { force: true });
          } catch {
            /* best effort */
          }
        }
      }
    }
    const file = join(dir, `${kind}.${safeExt}`);
    writeFileSync(file, bytes);
    return file;
  }
}
