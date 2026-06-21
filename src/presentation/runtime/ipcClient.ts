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

// Where the host lives, resolved per call (not cached) so a value injected by
// the Tauri shell after page creation is always honored:
//   1. `window.__EARTMP_API_BASE__` — the shell binds an ephemeral port and
//      injects the absolute loopback base before the app loads.
//   2. `VITE_API_BASE` — a build-time absolute base (legacy packaged build).
//   3. "/api" — dev, where Vite proxies to the fixed-port host.
function apiBase(): string {
  if (typeof window !== "undefined") {
    const injected = (window as { __EARTMP_API_BASE__?: unknown })
      .__EARTMP_API_BASE__;
    if (typeof injected === "string" && injected.length > 0) return injected;
  }
  return import.meta.env.VITE_API_BASE ?? "/api";
}
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
  const res = await fetch(`${apiBase()}/rpc`, {
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
    const res = await fetch(`${apiBase()}/lock-state`);
    const env = (await res.json()) as Envelope<{
      locked: boolean;
      required: boolean;
    }>;
    if (!env.ok) throw new CoreApiError(env.error);
    return env.data;
  },

  async unlock(input: { passphrase: string }) {
    const res = await fetch(`${apiBase()}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const env = (await res.json()) as Envelope<{ locked: boolean }>;
    if (!env.ok) throw new CoreApiError(env.error);
    return env.data;
  },

  async login(input: LoginInput) {
    const res = await fetch(`${apiBase()}/login`, {
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
    await fetch(`${apiBase()}/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
    setToken(null);
  },

  async currentUser() {
    if (!token) return null;
    const res = await fetch(`${apiBase()}/me`, { headers: authHeaders() });
    const env = (await res.json()) as Envelope<SessionView | null>;
    return env.ok ? env.data : null;
  },

  changePassword: (input) => rpc("changePassword", input),
  listStudents: (input) => rpc("listStudents", input),
  getStudent: (input) => rpc("getStudent", input),
  admitStudent: (input) => rpc("admitStudent", input),
  previewMatricule: (input) => rpc("previewMatricule", input),
  readmitStudent: (input) => rpc("readmitStudent", input),
  regenerateMatricule: (input) => rpc("regenerateMatricule", input),
  findDuplicateCandidates: (input) => rpc("findDuplicateCandidates", input),
  mergeStudents: (input) => rpc("mergeStudents", input),
  bulkRegenerateMatricules: (input) => rpc("bulkRegenerateMatricules", input),
  updateStudent: (input) => rpc("updateStudent", input),
  changeStudentStatus: (input) => rpc("changeStudentStatus", input),
  listFaculties: (input) => rpc("listFaculties", input),
  listDepartments: (input) => rpc("listDepartments", input),
  listProgrammes: (input) => rpc("listProgrammes", input),
  listLevels: (input) => rpc("listLevels", input),
  listSessions: (input) => rpc("listSessions", input),
  listSemesters: (input) => rpc("listSemesters", input),
  listCourses: (input) => rpc("listCourses", input),
  listSubDepartments: (input) => rpc("listSubDepartments", input),
  createFaculty: (input) => rpc("createFaculty", input),
  listInstitutions: (input) => rpc("listInstitutions", input),
  createInstitution: (input) => rpc("createInstitution", input),
  updateInstitutionById: (input) => rpc("updateInstitutionById", input),
  uploadInstitutionAsset: (input) => rpc("uploadInstitutionAsset", input),
  deleteInstitution: (input) => rpc("deleteInstitution", input),
  setDefaultInstitution: (input) => rpc("setDefaultInstitution", input),
  updateFaculty: (input) => rpc("updateFaculty", input),
  deleteFaculty: (input) => rpc("deleteFaculty", input),
  createDepartment: (input) => rpc("createDepartment", input),
  updateDepartment: (input) => rpc("updateDepartment", input),
  deleteDepartment: (input) => rpc("deleteDepartment", input),
  createSubDepartment: (input) => rpc("createSubDepartment", input),
  updateSubDepartment: (input) => rpc("updateSubDepartment", input),
  deleteSubDepartment: (input) => rpc("deleteSubDepartment", input),
  createProgramme: (input) => rpc("createProgramme", input),
  updateProgramme: (input) => rpc("updateProgramme", input),
  deleteProgramme: (input) => rpc("deleteProgramme", input),
  createLevel: (input) => rpc("createLevel", input),
  updateLevel: (input) => rpc("updateLevel", input),
  deleteLevel: (input) => rpc("deleteLevel", input),
  createCourse: (input) => rpc("createCourse", input),
  updateCourse: (input) => rpc("updateCourse", input),
  deleteCourse: (input) => rpc("deleteCourse", input),
  getAssessmentStructure: (input) => rpc("getAssessmentStructure", input),
  previewFinalScore: (input) => rpc("previewFinalScore", input),
  enterResult: (input) => rpc("enterResult", input),
  getStudentSemesterResults: (input) => rpc("getStudentSemesterResults", input),
  processSemester: (input) => rpc("processSemester", input),
  lockSemesterResults: (input) => rpc("lockSemesterResults", input),
  unlockResult: (input) => rpc("unlockResult", input),
  saveCourseResults: (input) => rpc("saveCourseResults", input),
  listCourseRoster: (input) => rpc("listCourseRoster", input),
  parseWorkbook: (input) => rpc("parseWorkbook", input),
  importResults: (input) => rpc("importResults", input),
  importStudents: (input) => rpc("importStudents", input),
  importCourses: (input) => rpc("importCourses", input),
  getAcademicSummary: (input) => rpc("getAcademicSummary", input),
  listTranscripts: (input) => rpc("listTranscripts", input),
  listTranscriptRecords: (input) => rpc("listTranscriptRecords", input),
  generateTranscript: (input) => rpc("generateTranscript", input),
  generateCertificate: (input) => rpc("generateCertificate", input),
  verifyTranscript: (input) => rpc("verifyTranscript", input),
  approveTranscript: (input) => rpc("approveTranscript", input),
  lockTranscript: (input) => rpc("lockTranscript", input),
  revokeTranscript: (input) => rpc("revokeTranscript", input),
  exportTranscript: (input) => rpc("exportTranscript", input),
  keyState: (input) => rpc("keyState", input),
  keyStatus: (input) => rpc("keyStatus", input),
  provisionSigningKey: (input) => rpc("provisionSigningKey", input),
  unsealKey: (input) => rpc("unsealKey", input),
  sealKey: (input) => rpc("sealKey", input),
  evaluateGraduation: (input) => rpc("evaluateGraduation", input),
  graduateStudent: (input) => rpc("graduateStudent", input),
  getAuditLog: (input) => rpc("getAuditLog", input),
  verifyAuditChain: (input) => rpc("verifyAuditChain", input),
  createBackup: (input) => rpc("createBackup", input),
  verifyBackup: (input) => rpc("verifyBackup", input),
  restoreBackup: (input) => rpc("restoreBackup", input),
  listNotifications: (input) => rpc("listNotifications", input),
  markNotificationRead: (input) => rpc("markNotificationRead", input),
  markAllNotificationsRead: (input) => rpc("markAllNotificationsRead", input),
  getInstitution: (input) => rpc("getInstitution", input),
  updateInstitution: (input) => rpc("updateInstitution", input),
  getSetting: (input) => rpc("getSetting", input),
  setSetting: (input) => rpc("setSetting", input),
  listGradeScales: (input) => rpc("listGradeScales", input),
  setDefaultGradeScale: (input) => rpc("setDefaultGradeScale", input),
  createGradeScale: (input) => rpc("createGradeScale", input),
  updateGradeScale: (input) => rpc("updateGradeScale", input),
  deleteGradeScale: (input) => rpc("deleteGradeScale", input),
  listAssessmentConfigs: (input) => rpc("listAssessmentConfigs", input),
  setDefaultAssessmentConfig: (input) =>
    rpc("setDefaultAssessmentConfig", input),
  createAssessmentConfig: (input) => rpc("createAssessmentConfig", input),
  updateAssessmentConfig: (input) => rpc("updateAssessmentConfig", input),
  deleteAssessmentConfig: (input) => rpc("deleteAssessmentConfig", input),
  changeKeyPassphrase: (input) => rpc("changeKeyPassphrase", input),
  listUsers: (input) => rpc("listUsers", input),
  listRoles: (input) => rpc("listRoles", input),
  createUser: (input) => rpc("createUser", input),
  setUserFaculties: (input) => rpc("setUserFaculties", input),
  deactivateUser: (input) => rpc("deactivateUser", input),
  activateUser: (input) => rpc("activateUser", input),
  assignRole: (input) => rpc("assignRole", input),
  resetUserPassword: (input) => rpc("resetUserPassword", input),
  updateUserDetails: (input) => rpc("updateUserDetails", input),
  listPermissions: (input) => rpc("listPermissions", input),
  createRole: (input) => rpc("createRole", input),
  updateRole: (input) => rpc("updateRole", input),
  deleteRole: (input) => rpc("deleteRole", input),
  setRolePermissions: (input) => rpc("setRolePermissions", input),
};
