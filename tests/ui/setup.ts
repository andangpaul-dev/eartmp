/**
 * UI test setup — ensures a working `localStorage`. The webview's ipcClient
 * reads localStorage at module load; jsdom + Node's experimental localStorage
 * global can collide and leave a stub without `getItem`. Install a simple
 * Map-backed implementation whenever the runtime's is missing or broken. No-op
 * for node-env tests that never touch it.
 */
import { configure } from "@testing-library/dom";

// The default 1000ms async timeout spuriously trips when the suite runs under
// heavy load (slow jsdom transforms). `findBy*`/`waitFor` still resolve as soon
// as the element appears, so a larger ceiling adds headroom without slowing the
// happy path — it removes the load-induced flakes (import-students, roles).
configure({ asyncUtilTimeout: 5000 });

const store = new Map<string, string>();
const shim: Storage = {
  getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const existing = (globalThis as { localStorage?: Storage }).localStorage;
if (!existing || typeof existing.getItem !== "function") {
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
}
