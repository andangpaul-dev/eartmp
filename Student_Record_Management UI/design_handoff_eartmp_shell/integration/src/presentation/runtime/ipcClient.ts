/**
 * EARTMP — WEBVIEW IPC client (runs in React; the ONLY path UI → core)
 * ============================================================================
 * Target: `src/presentation/runtime/ipcClient.ts`
 *
 * Implements CoreApi by forwarding each method over a single Tauri command
 * to the host dispatcher, then unwrapping the { ok, … } envelope into a
 * value or a thrown CoreError.
 *
 * The webview imports NOTHING from src/infrastructure/** or the DI container
 * — only this client + pure types. That preserves the architecture boundary
 * (tests/architecture.test.ts).
 */

import type { CoreApi, CoreMethod } from "./contract";
import { CoreError, type CoreErrorEnvelope } from "./errors";

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: CoreErrorEnvelope;
}

/**
 * `invokeCommand` is your Tauri bridge, e.g.
 *   import { invoke } from "@tauri-apps/api/core";
 *   const bridge = (method, input) =>
 *     invoke("execute_use_case", { method, input }) as Promise<Envelope>;
 * Injected so the client is transport-agnostic and unit-testable.
 */
export function createIpcClient(
  invokeCommand: (method: CoreMethod, input: unknown) => Promise<Envelope>,
): CoreApi {
  async function call<T>(method: CoreMethod, input?: unknown): Promise<T> {
    let env: Envelope;
    try {
      env = await invokeCommand(method, input ?? null);
    } catch (transportErr) {
      // IPC/transport failure (host crashed, command not registered, …).
      throw new CoreError(
        "UNKNOWN",
        `Could not reach the core (${String(transportErr)}).`,
      );
    }
    if (!env.ok) {
      throw CoreError.fromEnvelope(
        env.error ?? { code: "UNKNOWN", message: "Unknown error." },
      );
    }
    return env.data as T;
  }

  return {
    // Auth & session
    login: (i) => call("login", i),
    logout: () => call("logout"),
    currentUser: () => call("currentUser"),
    changePassword: (i) => call("changePassword", i),
    unlockSigningKey: (i) => call("unlockSigningKey", i),

    // Students
    listStudents: (i) => call("listStudents", i),
    getStudent: (i) => call("getStudent", i),
    admitStudent: (i) => call("admitStudent", i),
    updateStudent: (i) => call("updateStudent", i),
    changeStudentStatus: (i) => call("changeStudentStatus", i),

    // Results
    getStudentSemesterResults: (i) => call("getStudentSemesterResults", i),
    enterResult: (i) => call("enterResult", i),
    lockSemesterResults: (i) => call("lockSemesterResults", i),
    unlockResult: (i) => call("unlockResult", i),
    processSemester: (i) => call("processSemester", i),

    // Import
    importResults: (i) => call("importResults", i),

    // Summary & transcripts
    getAcademicSummary: (i) => call("getAcademicSummary", i),
    generateTranscript: (i) => call("generateTranscript", i),
    verifyTranscript: (i) => call("verifyTranscript", i),
    approveTranscript: (i) => call("approveTranscript", i),
    exportTranscript: (i) => call("exportTranscript", i),

    // Graduation
    evaluateGraduation: (i) => call("evaluateGraduation", i),
    graduateStudent: (i) => call("graduateStudent", i),

    // Audit
    getAuditLog: (i) => call("getAuditLog", i),
    verifyAuditChain: (i) => call("verifyAuditChain", i),
  };
}

/* ── Import (results) note ───────────────────────────────────────────────
 * ImportResults takes already-parsed `rows`. Parse the workbook on the HOST
 * (SheetJS behind SpreadsheetReaderPort) and send rows — OR add a host
 * command that takes a file path, parses, and calls ImportResults. The
 * latter is preferred for 100k-row files so you don't push a huge array
 * through IPC. Either way the webview only sees importResults().
 *
 * ── Binary export note ───────────────────────────────────────────────────
 * exportTranscript returns Uint8Array bytes. Across Tauri IPC, return a
 * base64 string from the host and decode here, or have the host write the
 * file and return a path. Don't assume a raw Uint8Array survives JSON.
 */
