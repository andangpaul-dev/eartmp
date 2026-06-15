/**
 * Assemble the Tauri Node-sidecar payload (Item 1, packaging). Produces a
 * self-contained `dist-host/` the Tauri shell ships as a resource:
 *   - server.mjs        (esbuild bundle of the host)
 *   - package.json      (runtime deps only)
 *   - node_modules/     (pruned production deps: Prisma client+engine, Argon2,
 *                        libSQL — the natives that can't be bundled)
 *   - node_modules/.prisma  (the client generated against THIS schema + engine)
 * and copies the platform `node` to src-tauri/binaries/eartmp-node-<triple>.
 *
 * Run: npm run assemble:sidecar   (then verify with the isolated run in the
 * packaging runbook). Network is used once to install the pruned deps.
 */
import { execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  existsSync,
  copyFileSync,
  readFileSync,
} from "node:fs";

const OUT = "dist-host";
const RUNTIME_DEP_NAMES = [
  "@prisma/client",
  "@node-rs/argon2",
  "@libsql/client",
];

const TRIPLES: Record<string, string> = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

function run(cmd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function main(): void {
  const root = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };
  const deps: Record<string, string> = {};
  for (const name of RUNTIME_DEP_NAMES) {
    const v = root.dependencies[name];
    if (!v) throw new Error(`Missing runtime dep in package.json: ${name}`);
    deps[name] = v;
  }

  console.log("1) bundle the host:");
  run("npm run bundle:host");

  console.log("2) write the sidecar package.json (runtime deps only):");
  writeFileSync(
    `${OUT}/package.json`,
    JSON.stringify(
      {
        name: "eartmp-host",
        private: true,
        type: "module",
        dependencies: deps,
      },
      null,
      2,
    ) + "\n",
  );

  console.log("3) install pruned production deps into the payload:");
  run(`npm install --omit=dev --prefix ${OUT} --no-audit --no-fund`);

  console.log(
    "4) copy the Prisma client generated against this schema + engine:",
  );
  const genSrc = "node_modules/.prisma";
  if (!existsSync(genSrc))
    throw new Error(
      "node_modules/.prisma missing — run `npx prisma generate`.",
    );
  cpSync(genSrc, `${OUT}/node_modules/.prisma`, { recursive: true });

  console.log("5) stage the Node runtime as the Tauri sidecar binary:");
  const key = `${process.platform}-${process.arch}`;
  const triple = TRIPLES[key];
  if (!triple) {
    console.log(`   ! no triple mapping for ${key}; copy node manually.`);
  } else {
    mkdirSync("src-tauri/binaries", { recursive: true });
    const ext = process.platform === "win32" ? ".exe" : "";
    const dest = `src-tauri/binaries/eartmp-node-${triple}${ext}`;
    copyFileSync(process.execPath, dest);
    console.log(`   ✓ ${process.execPath} → ${dest}`);
  }

  console.log(
    `\nSidecar payload assembled in ${OUT}/. Verify with an isolated run (see docs/packaging-runbook.md).`,
  );
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
