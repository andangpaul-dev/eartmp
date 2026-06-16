/**
 * UI test harness — renders a screen wrapped in the real CoreProvider +
 * KeyProvider with a MOCK CoreApi (no host, no DB). `renderScreen` seeds the
 * session/permissions and lets each test override only the CoreApi methods it
 * cares about. jest-dom matchers are registered here.
 */
import "@testing-library/jest-dom/vitest";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { CoreProvider } from "../../src/presentation/runtime/CoreProvider";
import { KeyProvider } from "../../src/presentation/runtime/KeyProvider";
import type {
  CoreApi,
  SessionView,
} from "../../src/presentation/runtime/contract";

export function makeSession(permissions: string[] = []): SessionView {
  return { userId: "u-test", role: "TEST_ROLE", permissions };
}

/** A CoreApi whose every method resolves to a benign default; tests override. */
export function makeCore(overrides: Partial<CoreApi> = {}): CoreApi {
  const emptyPage = { items: [], total: 0 };
  const base: CoreApi = {
    lockState: async () => ({ locked: false, required: false }),
    unlock: async () => ({ locked: false }),
    login: async () => ({ token: "t", session: makeSession() }),
    logout: async () => {},
    currentUser: async () => null,
    changePassword: async () => {},
    listStudents: async () => emptyPage,
    getStudent: async () => ({}) as never,
    admitStudent: async () => ({ student: {} as never }),
    updateStudent: async () => ({}) as never,
    changeStudentStatus: async () => ({}) as never,
    listFaculties: async () => [],
    listDepartments: async () => [],
    listProgrammes: async () => [],
    listLevels: async () => [],
    listSessions: async () => [],
    listSemesters: async () => [],
    listCourses: async () => emptyPage,
    listSubDepartments: async () => [],
    createFaculty: async () => ({}) as never,
    updateFaculty: async () => ({}) as never,
    deleteFaculty: async () => {},
    createDepartment: async () => ({}) as never,
    updateDepartment: async () => ({}) as never,
    deleteDepartment: async () => {},
    createSubDepartment: async () => ({}) as never,
    updateSubDepartment: async () => ({}) as never,
    deleteSubDepartment: async () => {},
    createProgramme: async () => ({}) as never,
    updateProgramme: async () => ({}) as never,
    deleteProgramme: async () => {},
    createLevel: async () => ({}) as never,
    updateLevel: async () => ({}) as never,
    deleteLevel: async () => {},
    createCourse: async () => ({}) as never,
    updateCourse: async () => ({}) as never,
    deleteCourse: async () => {},
    getAssessmentStructure: async () => [],
    previewFinalScore: async () => 0,
    enterResult: async () => ({}) as never,
    getStudentSemesterResults: async () => [],
    processSemester: async () => ({}) as never,
    lockSemesterResults: async () => 0,
    unlockResult: async () => {},
    parseWorkbook: async () => [],
    importResults: async () => ({}) as never,
    getAcademicSummary: async () => ({}) as never,
    listTranscripts: async () => [],
    listTranscriptRecords: async () => [],
    generateTranscript: async () => ({}) as never,
    verifyTranscript: async () => ({
      valid: true,
      transcriptNumber: "TR-1",
      status: "APPROVED",
      signatureValid: true,
      revoked: false,
      keyMatches: true,
    }),
    approveTranscript: async () => ({}) as never,
    lockTranscript: async () => ({}) as never,
    revokeTranscript: async () => ({}) as never,
    exportTranscript: async () => ({
      base64: "",
      filename: "t.pdf",
      contentType: "application/pdf",
    }),
    keyState: async () => ({ sealed: true }),
    unsealKey: async () => ({ sealed: false }),
    sealKey: async () => ({ sealed: true }),
    evaluateGraduation: async () => ({ eligible: false, criteria: [] }),
    graduateStudent: async () => ({}) as never,
    getAuditLog: async () => emptyPage,
    verifyAuditChain: async () => ({ valid: true, checked: 0, total: 0 }),
    getInstitution: async () => ({}) as never,
    updateInstitution: async () => ({}) as never,
    getSetting: async () => ({}),
    setSetting: async () => {},
    listGradeScales: async () => [],
    setDefaultGradeScale: async () => {},
    listAssessmentConfigs: async () => [],
    setDefaultAssessmentConfig: async () => {},
    changeKeyPassphrase: async () => {},
    listUsers: async () => [],
    listRoles: async () => [],
    createUser: async () => ({ id: "u-new" }),
    deactivateUser: async () => {},
    activateUser: async () => {},
    assignRole: async () => {},
    resetUserPassword: async () => {},
  };
  return { ...base, ...overrides };
}

export interface RenderScreenResult extends RenderResult {
  core: CoreApi;
  user: ReturnType<typeof userEvent.setup>;
}

/** Drive the shared StudentPicker: type a query, then click the matched option. */
export async function pickStudent(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  optionMatcher: RegExp,
): Promise<void> {
  const { screen } = await import("@testing-library/react");
  await user.type(await screen.findByLabelText(/find student/i), query);
  await user.click(await screen.findByRole("button", { name: optionMatcher }));
}

export function renderScreen(
  ui: ReactElement,
  opts: { permissions?: string[]; core?: Partial<CoreApi> } = {},
): RenderScreenResult {
  const session = makeSession(opts.permissions ?? []);
  const core = makeCore({
    currentUser: async () => session,
    ...opts.core,
  });
  const result = render(
    <CoreProvider client={core}>
      <KeyProvider>{ui}</KeyProvider>
    </CoreProvider>,
  );
  return { ...result, core, user: userEvent.setup() };
}
