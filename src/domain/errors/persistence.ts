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

/**
 * Thrown when a write violates a UNIQUE constraint (a duplicate key). `field`
 * names the conflicting column when the adapter can identify it, so callers can
 * decide whether the collision is retryable (e.g. a raced transcript number) or
 * a genuine duplicate to surface to the user.
 */
export class UniqueConstraintError extends Error {
  constructor(
    readonly field?: string,
    message = field
      ? `A record with this ${field} already exists.`
      : "A record with this value already exists.",
  ) {
    super(message);
    this.name = "UniqueConstraintError";
  }
}
