/**
 * Field-scoped validation error. Carries a `fields` map (input name → message)
 * so the host can forward it to the webview and forms can show the message
 * inline on the offending field instead of only a general alert. Classified as
 * VALIDATION by the host error mapper.
 */
export class ValidationError extends Error {
  readonly fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ValidationError";
    if (fields) this.fields = fields;
  }

  /** Build from a single field: message doubles as the field message. */
  static field(name: string, message: string): ValidationError {
    return new ValidationError(message, { [name]: message });
  }
}
