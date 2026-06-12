/**
 * JsonLogger — structured LoggerPort (Phase 19). Emits one JSON object per line
 * and REDACTS secret-ish keys (passphrase/privateKey/sealed/token/secret/salt/
 * signature) recursively before output (AD19.4), so logs never leak key material.
 */
import type {
  LoggerPort,
  LogContext,
} from "../../application/ports/LoggerPort";

const SECRET_KEY =
  /pass(word|phrase)|private[_-]?key|sealed|secret|token|salt|signature/i;

/** Recursively replace secret-ish values with a redaction marker. */
export function redact(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "[REDACTED]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = redact(value as LogContext);
    } else {
      out[key] = value;
    }
  }
  return out;
}

type Level = "info" | "warn" | "error";

export class JsonLogger implements LoggerPort {
  constructor(
    private readonly sink: (line: string) => void = (l) => console.log(l),
  ) {}

  private emit(level: Level, message: string, context?: LogContext): void {
    const entry = {
      level,
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    this.sink(JSON.stringify(entry));
  }

  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.emit("error", message, context);
  }
}
