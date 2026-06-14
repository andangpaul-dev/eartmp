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
import { buildHost } from "./composition";
import { createCore } from "./dispatcher";

const PORT = Number(process.env.EARTMP_HOST_PORT ?? 5179);
const core = createCore(buildHost(getPrisma()));

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(json);
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
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
    if (req.method === "OPTIONS") return send(res, 204, {});

    try {
      if (req.method === "POST" && url === "/api/login") {
        const body = await readJson(req);
        try {
          const result = await core.login({
            username: String(body.username ?? ""),
            password: String(body.password ?? ""),
          });
          return send(res, 200, { ok: true, data: result });
        } catch {
          return send(res, 200, {
            ok: false,
            error: {
              code: "UNAUTHENTICATED",
              message: "Invalid username or password.",
            },
          });
        }
      }

      if (req.method === "POST" && url === "/api/logout") {
        const token = bearer(req);
        if (token) await core.logout(token);
        return send(res, 200, { ok: true, data: null });
      }

      if (req.method === "GET" && url === "/api/me") {
        const session = await core.currentUser(bearer(req));
        return send(res, 200, { ok: true, data: session });
      }

      if (req.method === "POST" && url === "/api/rpc") {
        const body = await readJson(req);
        const envelope = await core.dispatch(
          String(body.method ?? ""),
          body.input,
          bearer(req),
        );
        return send(res, 200, envelope);
      }

      return send(res, 404, {
        ok: false,
        error: { code: "NOT_FOUND", message: "No such route." },
      });
    } catch (e) {
      return send(res, 200, {
        ok: false,
        error: {
          code: "INTERNAL",
          message: (e as Error).message ?? "Host error.",
        },
      });
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`EARTMP host listening on http://127.0.0.1:${PORT}`);
});
