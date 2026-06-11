/**
 * Transcript domain error (binding, generation, verification).
 */
export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}
