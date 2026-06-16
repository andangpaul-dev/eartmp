/**
 * Host port resolution + the stdout handshake the Tauri shell parses.
 *
 * The shell spawns the sidecar with `EARTMP_HOST_PORT=0` (an OS-assigned
 * ephemeral port) to avoid colliding with an orphaned host or a second
 * instance, then reads the actual bound port back from a machine-readable line
 * the host prints once it is listening. Dev (`npm run dev`) leaves the env unset
 * and keeps the fixed 5179 the Vite proxy targets.
 *
 * Pure + side-effect-free so it is unit-testable without starting the server.
 */
export const DEV_DEFAULT_PORT = 5179;

/** The port to bind. `0` ⇒ ephemeral (OS-assigned); unset ⇒ the dev default. */
export function resolveHostPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EARTMP_HOST_PORT;
  if (raw === undefined || raw.trim() === "") return DEV_DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return DEV_DEFAULT_PORT;
  return n;
}

/** Prefix of the line the host prints once listening, for the shell to parse. */
export const HANDSHAKE_PREFIX = "EARTMP_HOST_PORT=";

export function handshakeLine(port: number): string {
  return `${HANDSHAKE_PREFIX}${port}`;
}

/** Parse a bound port from a host stdout line, or null if it isn't the handshake. */
export function parseHandshakeLine(line: string): number | null {
  const t = line.trim();
  if (!t.startsWith(HANDSHAKE_PREFIX)) return null;
  const n = Number(t.slice(HANDSHAKE_PREFIX.length));
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null;
}
