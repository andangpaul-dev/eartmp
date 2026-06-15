/**
 * Bundle the Node host into a single CJS file for sidecar packaging (Item 1).
 * esbuild bundles all pure-JS deps; native modules (Prisma's query engine,
 * argon2's .node binary) CANNOT be inlined — they're marked external and must
 * ship alongside in node_modules. The goal here is to learn exactly what the
 * Tauri sidecar must carry, and to prove the bundled host still runs.
 *
 * Output: dist-host/server.cjs   Run: npm run bundle:host
 */
import { rmSync, mkdirSync, statSync } from "node:fs";
import { build } from "esbuild";

const OUT = "dist-host";

// Native or runtime-resolved deps that must be loaded from node_modules at
// runtime rather than inlined into the bundle.
// Only NATIVE modules must be external (their .node binaries can't be inlined);
// they ship in node_modules. Pure-JS CJS libs (xlsx, pdfmake, qrcode) bundle
// fine once the banner gives esbuild's __require a real `require` to fall back
// to for their dynamic require() of node builtins.
const EXTERNAL = [
  "@prisma/client",
  ".prisma/client",
  "@prisma/engines",
  "@node-rs/argon2",
  "@node-rs/*",
  "@libsql/client", // native libSQL driver (encrypted-at-rest path, ADR-008)
  "@libsql/*",
  "libsql",
];

// esbuild ESM recipe: define require/__filename/__dirname so bundled CJS deps
// that call require()/__dirname at runtime resolve against the real module
// system instead of esbuild's throwing stub.
const BANNER = `import { createRequire as __cr } from 'node:module';
import { fileURLToPath as __furl } from 'node:url';
import { dirname as __dn } from 'node:path';
const require = __cr(import.meta.url);
const __filename = __furl(import.meta.url);
const __dirname = __dn(__filename);`;

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const result = await build({
    entryPoints: ["src/host/server.ts"],
    outfile: `${OUT}/server.mjs`,
    bundle: true,
    platform: "node",
    target: "node20",
    // ESM so the core's `import.meta.url` (PdfMakeRenderer font loading) works.
    format: "esm",
    external: EXTERNAL,
    banner: { js: BANNER },
    sourcemap: false,
    logLevel: "info",
    metafile: true,
  });

  const size = statSync(`${OUT}/server.mjs`).size;
  const inputs = Object.keys(result.metafile.inputs).length;
  console.log(
    `\nBundled ${inputs} modules → ${OUT}/server.mjs (${(size / 1024).toFixed(0)} KB)`,
  );
  console.log(`External (ship in node_modules): ${EXTERNAL.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
