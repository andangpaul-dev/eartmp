/**
 * Dev launcher (shell phase) — starts the Node host and the Vite webview server
 * together with one command (`npm run dev`), prefixing each process's output.
 * The webview (http://127.0.0.1:1420) reaches the host (http://127.0.0.1:5179)
 * through Vite's `/api` proxy. Ctrl-C stops both. Dependency-free (no
 * concurrently): offline-first, nothing new to install.
 *
 * Prereq: run `npm run db:seed` once. Default login: admin / ChangeMe123!
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";

interface Proc {
  name: string;
  cmd: string;
  color: string;
}

const RESET = "[0m";
const procs: Proc[] = [
  { name: "host", cmd: "npm run host:serve", color: "[36m" }, // cyan
  { name: "ui", cmd: "npm run ui:dev", color: "[35m" }, // magenta
];

const children: ChildProcess[] = [];
let shuttingDown = false;

function stamp(p: Proc, line: string): void {
  process.stdout.write(`${p.color}[${p.name}]${RESET} ${line}\n`);
}

function killTree(c: ChildProcess): void {
  if (!c.pid || c.killed) return;
  if (process.platform === "win32") {
    // npm wraps a shell that spawns node/vite grandchildren; a plain SIGTERM
    // to the wrapper orphans them (they keep holding the ports). taskkill /T
    // kills the whole tree.
    try {
      execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    c.kill("SIGTERM");
  }
}

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c);
  process.exit(code);
}

for (const p of procs) {
  const child = spawn(p.cmd, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  const pipe = (chunk: Buffer): void => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) stamp(p, line);
    }
  };
  child.stdout?.on("data", pipe);
  child.stderr?.on("data", pipe);
  child.on("exit", (code) => {
    stamp(p, `exited (${code ?? 0})`);
    shutdown(code ?? 0);
  });
}

stamp(
  { name: "dev", cmd: "", color: "[32m" },
  "host → http://127.0.0.1:5179 · webview → http://127.0.0.1:1420 (Ctrl-C to stop)",
);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
