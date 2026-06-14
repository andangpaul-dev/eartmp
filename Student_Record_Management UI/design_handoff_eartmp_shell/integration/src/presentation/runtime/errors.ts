/**
 * EARTMP — UI error model + IPC envelope
 * ============================================================================
 * Target: `src/presentation/runtime/errors.ts`  (PURE — webview-safe)
 *
 * The core throws typed domain errors (AuthorizationError, AuthenticationError,
 * RecordsError, TranscriptError, …). Across IPC they arrive as a serialized
 * envelope. Host (serializing) and webview (receiving) both normalize to ONE
 * shape the UI branches on: CoreError, a coarse `code` + optional field map.
 */

export type CoreErrorCode =
  | "UNAUTHENTICATED" // no/anonymous session for a non-public use-case
  | "FORBIDDEN" // AuthorizationError — missing permission
  | "VALIDATION" // bad input / domain rule; per-field messages in `.fields`
  | "CONFLICT" // e.g. duplicate matric (RecordsError)
  | "LOCKED" // editing a locked result without unlock
  | "KEY_SEALED" // signing key not unlocked this session
  | "NOT_FOUND"
  | "UNKNOWN";

/** Serialized error sent over IPC (host → webview). */
export interface CoreErrorEnvelope {
  code: CoreErrorCode;
  message: string;
  fields?: Record<string, string>;
}

export class CoreError extends Error {
  code: CoreErrorCode;
  fields?: Record<string, string>;
  constructor(
    code: CoreErrorCode,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.fields = fields;
  }
  static fromEnvelope(e: CoreErrorEnvelope): CoreError {
    return new CoreError(e.code, e.message, e.fields);
  }
}

/**
 * HOST side: map a thrown core error → envelope, by the error class name
 * (constructor.name) so infrastructure isn't imported here.
 * ⚠ RECONCILE the names with `src/domain/errors/**` and tighten the message
 * heuristics (the core uses message text for "already in use" / "locked").
 */
export function toErrorEnvelope(e: unknown): CoreErrorEnvelope {
  const err = e as {
    name?: string;
    message?: string;
    fields?: Record<string, string>;
  };
  const name = err?.name ?? "";
  const message = err?.message ?? "Something went wrong.";

  let code: CoreErrorCode = "UNKNOWN";
  if (name === "AuthorizationError") {
    code = /authentication required/i.test(message)
      ? "UNAUTHENTICATED"
      : "FORBIDDEN";
  } else if (name === "AuthenticationError") {
    code = "UNAUTHENTICATED"; // generic login failure (no user enumeration)
  } else if (name === "RecordsError") {
    if (/already in use|duplicate/i.test(message)) code = "CONFLICT";
    else if (/locked/i.test(message)) code = "LOCKED";
    else if (/not found/i.test(message)) code = "NOT_FOUND";
    else code = "VALIDATION";
  } else if (name === "TranscriptError") {
    if (/not found/i.test(message)) code = "NOT_FOUND";
    else code = "VALIDATION";
  }
  return { code, message, ...(err?.fields ? { fields: err.fields } : {}) };
}
