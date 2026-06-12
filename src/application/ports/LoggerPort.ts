/**
 * LoggerPort — structured application logging (Phase 19). Levels + a context
 * object; the concrete logger redacts secret-ish keys before output so
 * observability never leaks key material.
 */
export type LogContext = Record<string, unknown>;

export interface LoggerPort {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
