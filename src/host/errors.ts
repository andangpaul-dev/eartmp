/**
 * Host error mapping (shell phase). Translates the core's thrown domain errors
 * into the serializable `CoreError` the webview understands. Lives in the
 * trusted host layer (it may import domain errors); the webview only ever sees
 * the `{ code, message, fields? }` envelope.
 */
import type {
  CoreError,
  CoreErrorCode,
} from "../presentation/runtime/contract";

function classify(name: string, message: string): CoreErrorCode {
  if (name === "AuthorizationError") return "FORBIDDEN";
  if (name === "AuthenticationError") return "UNAUTHENTICATED";
  if (name === "ConcurrencyError") return "CONFLICT";
  if (name === "UniqueConstraintError") return "CONFLICT";
  // Message-driven refinement for the domain error families.
  if (/already (in use|exists)/i.test(message)) return "CONFLICT";
  if (/not found/i.test(message)) return "NOT_FOUND";
  if (/locked/i.test(message)) return "LOCKED";

  const VALIDATION_ERRORS = new Set([
    "ValidationError",
    "RecordsError",
    "StructureError",
    "SettingsError",
    "InstitutionError",
    "TranscriptError",
    "BackupError",
    "SecurityError",
    "GradeScaleError",
    "AssessmentError",
  ]);
  if (VALIDATION_ERRORS.has(name)) return "VALIDATION";
  return "INTERNAL";
}

export function toCoreError(err: unknown): CoreError {
  const e = err as { name?: string; message?: string; fields?: unknown };
  const name = typeof e?.name === "string" ? e.name : "Error";
  const message =
    typeof e?.message === "string" && e.message.length > 0
      ? e.message
      : "Unexpected error.";
  const code = classify(name, message);
  const error: CoreError = { code, message };
  if (e?.fields && typeof e.fields === "object") {
    error.fields = e.fields as Record<string, string>;
  }
  return error;
}
