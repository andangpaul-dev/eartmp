/**
 * Records domain error (students, courses, enrollment).
 */
export class RecordsError extends Error {
  /** Optional input name → message map for inline form display. */
  readonly fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "RecordsError";
    if (fields) this.fields = fields;
  }
}
