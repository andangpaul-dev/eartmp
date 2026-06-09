/**
 * Records domain error (students, courses, enrollment).
 */
export class RecordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordsError";
  }
}
