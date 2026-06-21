/**
 * Input validation at the host dispatch seam (resilience / hardening). The
 * webview is untrusted transport: every RPC payload is validated for SHAPE here
 * before it reaches a handler — defence in depth on top of the use-cases' own
 * domain validation.
 *
 * - Security-/mutation-critical methods get an explicit schema (required fields
 *   present + correctly typed).
 * - Every other method gets a BASELINE guard: the input must be an object.
 * - `looseObject` keeps unknown keys, so a method gaining a new field never has
 *   it silently stripped here. Failures surface as a VALIDATION CoreError.
 */
import { z } from "zod";
import { ValidationError } from "../domain/errors/validation";

const str = z.string();
const optStr = z.string().optional();

const SCHEMAS: Record<string, z.ZodType> = {
  // auth
  login: z.looseObject({ username: str, password: str }),
  changePassword: z.looseObject({ oldPassword: str, newPassword: str }),
  // signing keys / security
  provisionSigningKey: z.looseObject({
    passphrase: str,
    replaceExisting: z.boolean().optional(),
    institutionId: optStr,
  }),
  changeKeyPassphrase: z.looseObject({
    oldPassphrase: str,
    newPassphrase: str,
    institutionId: optStr,
  }),
  unsealKey: z.looseObject({ passphrase: str, institutionId: optStr }),
  // users & roles
  createUser: z.looseObject({
    username: str,
    email: str,
    fullName: str,
    roleId: str,
    password: str,
    institutionId: optStr,
  }),
  resetUserPassword: z.looseObject({ userId: str, newPassword: str }),
  assignRole: z.looseObject({ userId: str, roleId: str }),
  deactivateUser: z.looseObject({ userId: str }),
  activateUser: z.looseObject({ userId: str }),
  setRolePermissions: z.looseObject({
    roleId: str,
    permissionKeys: z.array(str),
  }),
  setUserFaculties: z.looseObject({ userId: str, facultyIds: z.array(str) }),
  // institutions
  createInstitution: z.looseObject({
    name: str,
    code: optStr,
    calendarType: optStr,
  }),
  // documents
  generateTranscript: z.looseObject({
    studentId: str,
    type: optStr,
    templateId: optStr,
  }),
  generateCertificate: z.looseObject({ studentId: str, templateId: optStr }),
  verifyTranscript: z.looseObject({ transcriptId: str }),
  // backup (envelope shape is validated in depth by the use-case)
  createBackup: z.looseObject({ passphrase: str }),
  verifyBackup: z.looseObject({ envelope: z.looseObject({}), passphrase: str }),
  restoreBackup: z.looseObject({
    envelope: z.looseObject({}),
    passphrase: str,
  }),
  // notifications
  markNotificationRead: z.looseObject({ id: str }),
  // results — extended fields + batch entry + course roster
  enterResult: z.looseObject({
    studentId: str,
    courseId: str,
    semesterId: str,
    componentScores: z.array(z.looseObject({ key: str, score: z.number() })),
    sitting: z.enum(["NORMAL", "RESIT"]).optional(),
    status: z.enum(["GRADED", "DID", "DISQUALIFIED", "INCOMPLETE"]).optional(),
  }),
  lockSemesterResults: z.looseObject({
    studentId: str,
    semesterId: str,
    sitting: z.enum(["NORMAL", "RESIT"]).optional(),
  }),
  saveCourseResults: z.looseObject({
    semesterId: str,
    courseId: str,
    sitting: z.enum(["NORMAL", "RESIT"]),
    rows: z.array(
      z.looseObject({
        studentId: str,
        componentScores: z.array(
          z.looseObject({ key: str, score: z.number() }),
        ),
        status: z
          .enum(["GRADED", "DID", "DISQUALIFIED", "INCOMPLETE"])
          .optional(),
      }),
    ),
  }),
  listCourseRoster: z.looseObject({ courseId: str, sessionName: str }),
  // WS C — student lifecycle / matricule management
  admitStudent: z.looseObject({
    fullName: str,
    admissionSession: str,
    programmeId: str,
    levelId: str,
  }),
  previewMatricule: z.looseObject({ facultyId: str, admissionSession: str }),
  readmitStudent: z.looseObject({
    studentId: str,
    programmeId: str,
    levelId: str,
    fromSession: str,
  }),
  regenerateMatricule: z.looseObject({ studentId: str }),
  mergeStudents: z.looseObject({ survivingId: str, duplicateId: str }),
  findDuplicateCandidates: z.looseObject({}),
  bulkRegenerateMatricules: z.looseObject({ facultyId: str, year: z.number() }),
  // WS D — grading-config CRUD
  createGradeScale: z.looseObject({
    name: str,
    bands: z.array(z.looseObject({})),
  }),
  updateGradeScale: z.looseObject({ id: str }),
  deleteGradeScale: z.looseObject({ id: str }),
  createAssessmentConfig: z.looseObject({
    name: str,
    components: z.array(z.looseObject({})),
  }),
  updateAssessmentConfig: z.looseObject({ id: str }),
  deleteAssessmentConfig: z.looseObject({ id: str }),
};

/** Every method at least requires its input to be an object (reject primitives). */
const BASELINE = z.looseObject({});

/**
 * Validate a method's input. Returns the parsed value (extra keys preserved);
 * throws ValidationError on a bad shape. A null/undefined input is treated as an
 * empty object so no-argument methods pass.
 */
export function validateMethodInput(method: string, input: unknown): unknown {
  const value = input === undefined || input === null ? {} : input;
  const schema = SCHEMAS[method] ?? BASELINE;
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? issue.path.join(".") : "input";
    throw new ValidationError(
      `Invalid input for "${method}": ${where} ${issue?.message ?? "is invalid"}.`,
    );
  }
  return result.data;
}
