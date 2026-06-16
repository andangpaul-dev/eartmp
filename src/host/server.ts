/**
 * Host HTTP transport (shell phase, Node sidecar). A tiny loopback server that
 * exposes the host `Core` facade to the webview over `/api/*`. In dev, Vite
 * proxies `/api` here; in a packaged Tauri app, this runs as a bundled Node
 * sidecar the webview reaches the same way. The webview sends a Bearer token;
 * the host owns the SessionContext (the UI never asserts its own privileges).
 * Run: npm run host:serve
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, statSync } from "node:fs";
import { getPrisma } from "../infrastructure/db/prisma";
import {
  getEncryptedPrisma,
  resolveDbSalt,
} from "../infrastructure/db/encryptedDatabase";
import { bootstrapDatabase } from "../infrastructure/db/bootstrap";
import { buildHost } from "./composition";
import { createCore, type Core } from "./dispatcher";
import { toCoreError } from "./errors";
import { resolveHostPort, handshakeLine } from "./hostPort";
import { startFileLoggingFromEnv } from "./logger";

// Mirror console output to a rotating app-data log file when the shell provides
// a directory (no-op in dev). Installed first so all startup logs are captured.
startFileLoggingFromEnv();

const PORT = resolveHostPort();
const MIGRATIONS_DIR = process.env.EARTMP_MIGRATIONS_DIR ?? "prisma/migrations";

// DB-at-rest encryption (ADR-008):
//   EARTMP_DB_PASSPHRASE set  → encrypted, auto-unlocked at startup (UAT).
//   EARTMP_REQUIRE_UNLOCK=1   → encrypted, LOCKED until /api/unlock (production).
//   neither                   → plaintext getPrisma (dev).
const DB_PASSPHRASE = process.env.EARTMP_DB_PASSPHRASE;
const REQUIRE_UNLOCK = process.env.EARTMP_REQUIRE_UNLOCK === "1";
const ENCRYPTED = Boolean(DB_PASSPHRASE) || REQUIRE_UNLOCK;

/** Absolute SQLite file path parsed from DATABASE_URL (encrypted path needs it). */
function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  return url.replace(/^file:/, "");
}

// `core` is null until the DB is unlocked + the host is built. Requests that
// need data are refused with LOCKED until then.
let core: Core | null = null;
let unlocking = false;

// The webview origins allowed to call the host. Dev = Vite; packaged = the
// Tauri webview (custom protocol / tauri.localhost). Anything else gets no
// ACAO header (so a stray browser tab can't read responses).
const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

/** Max request body (base64 workbooks are the largest legitimate payload). */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  res.writeHead(status, headers);
  res.end(json);
}

class PayloadTooLargeError extends Error {}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new PayloadTooLargeError("Request body too large.");
    }
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "";
    const origin = req.headers.origin;
    if (req.method === "OPTIONS") return send(res, 204, {}, origin);

    try {
      // Unlock lifecycle (available even while locked).
      if (req.method === "GET" && url === "/api/lock-state") {
        return send(
          res,
          200,
          { ok: true, data: { locked: core === null, required: ENCRYPTED } },
          origin,
        );
      }
      if (req.method === "POST" && url === "/api/unlock") {
        const body = await readJson(req);
        try {
          await unlock(String(body.passphrase ?? ""));
          return send(
            res,
            200,
            { ok: true, data: { locked: core === null } },
            origin,
          );
        } catch {
          return send(
            res,
            200,
            {
              ok: false,
              error: {
                code: "UNAUTHENTICATED",
                message: "Incorrect passphrase.",
              },
            },
            origin,
          );
        }
      }

      // Everything else needs an unlocked database.
      const c = core;
      if (c === null) {
        return send(
          res,
          200,
          {
            ok: false,
            error: { code: "LOCKED", message: "Database is locked." },
          },
          origin,
        );
      }

      if (req.method === "POST" && url === "/api/login") {
        const body = await readJson(req);
        try {
          const result = await c.login({
            username: String(body.username ?? ""),
            password: String(body.password ?? ""),
          });
          return send(res, 200, { ok: true, data: result }, origin);
        } catch (e) {
          // Surfaces the generic "Invalid credentials" or the lockout message,
          // both as UNAUTHENTICATED (no user enumeration beyond the lockout).
          return send(res, 200, { ok: false, error: toCoreError(e) }, origin);
        }
      }

      if (req.method === "POST" && url === "/api/logout") {
        const token = bearer(req);
        if (token) await c.logout(token);
        return send(res, 200, { ok: true, data: null }, origin);
      }

      if (req.method === "GET" && url === "/api/me") {
        const session = await c.currentUser(bearer(req));
        return send(res, 200, { ok: true, data: session }, origin);
      }

      if (req.method === "POST" && url === "/api/rpc") {
        const body = await readJson(req);
        const envelope = await c.dispatch(
          String(body.method ?? ""),
          body.input,
          bearer(req),
        );
        return send(res, 200, envelope, origin);
      }

      return send(
        res,
        404,
        { ok: false, error: { code: "NOT_FOUND", message: "No such route." } },
        origin,
      );
    } catch (e) {
      // Don't leak internal detail to the webview; log it host-side.
      console.error("[host] request error:", e);
      const tooLarge = e instanceof PayloadTooLargeError;
      return send(
        res,
        200,
        {
          ok: false,
          error: tooLarge
            ? { code: "VALIDATION", message: "Request body too large." }
            : { code: "INTERNAL", message: "Internal host error." },
        },
        origin,
      );
    }
  })();
});

/**
 * Open the DB (encrypted with the passphrase, or plaintext for dev), bootstrap
 * it, and build the host. Throws if a wrong passphrase can't decrypt the file.
 */
async function unlock(passphrase: string | undefined): Promise<void> {
  if (core || unlocking) return;
  unlocking = true;
  try {
    const file = dbFilePath();
    const preExisting = existsSync(file) && statSync(file).size > 0;
    const prisma =
      ENCRYPTED && passphrase
        ? await getEncryptedPrisma(passphrase, resolveDbSalt(file), file)
        : getPrisma();

    // If an encrypted DB already exists, the key must decrypt it. Probe a real
    // table and fail fast on a wrong passphrase — DON'T run migrations against
    // an undecryptable file (which corrupts/hangs).
    if (ENCRYPTED && preExisting) {
      try {
        await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
      } catch (e) {
        await prisma.$disconnect().catch(() => {});
        throw new Error("Database could not be decrypted (wrong passphrase).", {
          cause: e,
        });
      }
    }

    const provisioned = await bootstrapDatabase(prisma, MIGRATIONS_DIR);
    if (provisioned) console.log("EARTMP database provisioned (first launch).");
    core = createCore(buildHost(prisma));
    console.log(
      ENCRYPTED ? "EARTMP database unlocked." : "EARTMP database open.",
    );
  } finally {
    unlocking = false;
  }
}

async function start(): Promise<void> {
  // Auto-unlock when a passphrase is supplied (UAT) or for the plaintext dev
  // path; otherwise stay locked until /api/unlock (production REQUIRE_UNLOCK).
  if (!REQUIRE_UNLOCK) {
    await unlock(DB_PASSPHRASE);
  }
  server.listen(PORT, "127.0.0.1", () => {
    const addr = server.address();
    const boundPort =
      typeof addr === "object" && addr !== null ? addr.port : PORT;
    // Machine-readable handshake the Tauri shell parses to learn the actual
    // (possibly ephemeral) port. Must precede the human log line.
    console.log(handshakeLine(boundPort));
    console.log(
      `EARTMP host listening on http://127.0.0.1:${boundPort}` +
        (core ? "" : " (locked — awaiting unlock)"),
    );
  });
}

start().catch((e) => {
  console.error("EARTMP host failed to start:", e);
  process.exit(1);
});
