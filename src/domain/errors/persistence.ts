/**
 * Persistence-related domain errors.
 */

/** Thrown when an optimistic-lock (version) check fails — a stale write. */
export class ConcurrencyError extends Error {
  constructor(
    message = "The record was modified by someone else. Reload and retry.",
  ) {
    super(message);
    this.name = "ConcurrencyError";
  }
}
