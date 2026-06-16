/**
 * App-data file logging for the Node host (shell phase). In a packaged app the
 * sidecar has no terminal, so console output is lost; this mirrors every
 * console.{log,info,warn,error} to a rotating `host.log` under a directory the
 * Tauri shell provides (`EARTMP_LOG_DIR`, the per-user app-data dir). Console
 * output is preserved (the shell still drains stdout/stderr), so dev is
 * unchanged and a packaged install gains a durable, inspectable log.
 *
 * Single-backup size rotation: when `host.log` exceeds the cap it is rolled to
 * `host.log.1` (replacing any previous backup) and a fresh file is started — so
 * the log can never grow without bound on a long-lived install.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB, then rotate.

type ConsoleMethod = "log" | "info" | "warn" | "error";
const METHODS: ConsoleMethod[] = ["log", "info", "warn", "error"];

export interface FileLoggingOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
}

function rotateIfNeeded(file: string, maxBytes: number): void {
  try {
    if (existsSync(file) && statSync(file).size > maxBytes) {
      const backup = `${file}.1`;
      if (existsSync(backup)) rmSync(backup, { force: true });
      renameSync(file, backup);
    }
  } catch {
    // Rotation is best-effort; never let logging break the host.
  }
}

/**
 * Patch the console methods to also append timestamped lines to the log file.
 * Returns a restore function that undoes the patch (used by tests).
 */
export function initFileLogging(opts: FileLoggingOptions): () => void {
  const file = join(opts.dir, opts.fileName ?? "host.log");
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  mkdirSync(opts.dir, { recursive: true });

  const original: Record<ConsoleMethod, (...args: unknown[]) => void> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  for (const method of METHODS) {
    const prev = original[method];
    console[method] = (...args: unknown[]): void => {
      prev(...args);
      try {
        rotateIfNeeded(file, maxBytes);
        const line = `${new Date().toISOString()} [${method}] ${format(...args)}\n`;
        appendFileSync(file, line);
      } catch {
        // A logging failure must never crash the host.
      }
    };
  }

  return () => {
    for (const method of METHODS) console[method] = original[method];
  };
}

/**
 * Start file logging if the shell provided a log directory; otherwise a no-op
 * (dev / standalone host run keeps console-only output). Returns the restore
 * function, or null when logging wasn't started.
 */
export function startFileLoggingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): (() => void) | null {
  const dir = env.EARTMP_LOG_DIR;
  if (!dir || dir.trim() === "") return null;
  try {
    return initFileLogging({ dir });
  } catch {
    return null;
  }
}
