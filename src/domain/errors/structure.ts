/**
 * Academic-structure domain error.
 */
export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureError";
  }
}
