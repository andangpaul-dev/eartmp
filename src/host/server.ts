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
import { getPrisma } from "../infrastructure/db/prisma";
import { bootstrapDatabase } from "../infrastructure/db/bootstrap";
import { buildHost } from "./composition";
import { createCore, type Core } from "./dispatcher";
import { toCoreError } from "./errors";

const PORT = Number(process.env.EARTMP_HOST_PORT ?? 5179);
const MIGRATIONS_DIR = process.env.EARTMP_MIGRATIONS_DIR ?? "prisma/migrations";

// Assigned during startup, after the DB is bootstrapped. Requests only arrive
// once the server is listening, which happens after this is set.
let core: Core;

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
      if (req.method === "POST" && url === "/api/login") {
        const body = await readJson(req);
        try {
          const result = await core.login({
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
        if (token) await core.logout(token);
        return send(res, 200, { ok: true, data: null }, origin);
      }

      if (req.method === "GET" && url === "/api/me") {
        const session = await core.currentUser(bearer(req));
        return send(res, 200, { ok: true, data: session }, origin);
      }

      if (req.method === "POST" && url === "/api/rpc") {
        const body = await readJson(req);
        const envelope = await core.dispatch(
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

async function start(): Promise<void> {
  const prisma = getPrisma();
  // First launch: apply migrations + seed (idempotent; a no-op on an existing
  // DB). The packaged sidecar points at a fresh per-user DB.
  const provisioned = await bootstrapDatabase(prisma, MIGRATIONS_DIR);
  if (provisioned) console.log("EARTMP database provisioned (first launch).");
  core = createCore(buildHost(prisma));
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`EARTMP host listening on http://127.0.0.1:${PORT}`);
  });
}

start().catch((e) => {
  console.error("EARTMP host failed to start:", e);
  process.exit(1);
});
