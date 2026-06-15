/**
 * IPC client (webview). The browser-side implementation of `CoreApi`: it talks
 * to the Node host over `/api` and unwraps the `{ ok, data | error }` envelope.
 * A failed call throws a `CoreApiError` carrying the `CoreError.code` (+ `fields`
 * for form validation). PURE webview code — no infrastructure, no DB.
 */
import type {
  CoreApi,
  CoreError,
  Envelope,
  SessionView,
  LoginInput,
} from "./contract";

// Dev: "/api" (Vite proxies to the host). Packaged Tauri build: there is no
// proxy, so VITE_API_BASE is set to the sidecar's absolute loopback URL at build
// time (see docs/packaging-runbook.md).
const BASE = import.meta.env.VITE_API_BASE ?? "/api";
const TOKEN_KEY = "eartmp.token";

let token: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;

export class CoreApiError extends Error {
  readonly code: CoreError["code"];
  readonly fields?: Record<string, string>;
  constructor(error: CoreError) {
    super(error.message);
    this.name = "CoreApiError";
    this.code = error.code;
    if (error.fields) this.fields = error.fields;
  }
}

function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

// Notified when any RPC comes back UNAUTHENTICATED (expired/invalid session) so
// the app can clear state and return to Login centrally, instead of every
// screen handling it.
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: (() => void) | null): void {
  onUnauthenticated = fn;
}

async function rpc<T>(method: string, input: unknown): Promise<T> {
  const res = await fetch(`${BASE}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ method, input }),
  });
  const env = (await res.json()) as Envelope<T>;
  if (!env.ok) {
    if (env.error.code === "UNAUTHENTICATED") {
      setToken(null);
      onUnauthenticated?.();
    }
    throw new CoreApiError(env.error);
  }
  return env.data;
}

function setToken(next: string | null): void {
  token = next;
  if (typeof localStorage === "undefined") return;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

export const ipcClient: CoreApi = {
  async lockState() {
    // Throws if the host isn't listening yet (first-launch provisioning) so the
    // caller can retry; resolves once the host responds.
    const res = await fetch(`${BASE}/lock-state`);
    const env = (await res.json()) as Envelope<{
      locked: boolean;
      required: boolean;
    }>;
    if (!env.ok) throw new CoreApiError(env.error);
    return env.data;
  },

  async unlock(input: { passphrase: string }) {
    const res = await fetch(`${BASE}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const env = (await res.json()) as Envelope<{ locked: boolean }>;
    if (!env.ok) throw new CoreApiError(env.error);
    return env.data;
  },

  async login(input: LoginInput) {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const env = (await res.json()) as Envelope<{
      token: string;
      session: SessionView;
    }>;
    if (!env.ok) throw new CoreApiError(env.error);
    setToken(env.data.token);
    return env.data;
  },

  async logout() {
    await fetch(`${BASE}/logout`, { method: "POST", headers: authHeaders() });
    setToken(null);
  },

  async currentUser() {
    if (!token) return null;
    const res = await fetch(`${BASE}/me`, { headers: authHeaders() });
    const env = (await res.json()) as Envelope<SessionView | null>;
    return env.ok ? env.data : null;
  },

  changePassword: (input) => rpc("changePassword", input),
  listStudents: (input) => rpc("listStudents", input),
  getStudent: (input) => rpc("getStudent", input),
  admitStudent: (input) => rpc("admitStudent", input),
  updateStudent: (input) => rpc("updateStudent", input),
  changeStudentStatus: (input) => rpc("changeStudentStatus", input),
  listFaculties: (input) => rpc("listFaculties", input),
  listDepartments: (input) => rpc("listDepartments", input),
  listProgrammes: (input) => rpc("listProgrammes", input),
  listLevels: (input) => rpc("listLevels", input),
  listSessions: (input) => rpc("listSessions", input),
  listSemesters: (input) => rpc("listSemesters", input),
  listCourses: (input) => rpc("listCourses", input),
  getAssessmentStructure: (input) => rpc("getAssessmentStructure", input),
  previewFinalScore: (input) => rpc("previewFinalScore", input),
  enterResult: (input) => rpc("enterResult", input),
  getStudentSemesterResults: (input) => rpc("getStudentSemesterResults", input),
  processSemester: (input) => rpc("processSemester", input),
  lockSemesterResults: (input) => rpc("lockSemesterResults", input),
  unlockResult: (input) => rpc("unlockResult", input),
  parseWorkbook: (input) => rpc("parseWorkbook", input),
  importResults: (input) => rpc("importResults", input),
  getAcademicSummary: (input) => rpc("getAcademicSummary", input),
  listTranscripts: (input) => rpc("listTranscripts", input),
  generateTranscript: (input) => rpc("generateTranscript", input),
  verifyTranscript: (input) => rpc("verifyTranscript", input),
  approveTranscript: (input) => rpc("approveTranscript", input),
  lockTranscript: (input) => rpc("lockTranscript", input),
  revokeTranscript: (input) => rpc("revokeTranscript", input),
  exportTranscript: (input) => rpc("exportTranscript", input),
  keyState: (input) => rpc("keyState", input),
  unsealKey: (input) => rpc("unsealKey", input),
  sealKey: (input) => rpc("sealKey", input),
  evaluateGraduation: (input) => rpc("evaluateGraduation", input),
  graduateStudent: (input) => rpc("graduateStudent", input),
  getAuditLog: (input) => rpc("getAuditLog", input),
  verifyAuditChain: (input) => rpc("verifyAuditChain", input),
  getInstitution: (input) => rpc("getInstitution", input),
  updateInstitution: (input) => rpc("updateInstitution", input),
  getSetting: (input) => rpc("getSetting", input),
  setSetting: (input) => rpc("setSetting", input),
  listGradeScales: (input) => rpc("listGradeScales", input),
  setDefaultGradeScale: (input) => rpc("setDefaultGradeScale", input),
  listAssessmentConfigs: (input) => rpc("listAssessmentConfigs", input),
  setDefaultAssessmentConfig: (input) =>
    rpc("setDefaultAssessmentConfig", input),
  changeKeyPassphrase: (input) => rpc("changeKeyPassphrase", input),
  listUsers: (input) => rpc("listUsers", input),
  listRoles: (input) => rpc("listRoles", input),
  createUser: (input) => rpc("createUser", input),
  deactivateUser: (input) => rpc("deactivateUser", input),
  activateUser: (input) => rpc("activateUser", input),
  assignRole: (input) => rpc("assignRole", input),
  resetUserPassword: (input) => rpc("resetUserPassword", input),
};
