/**
 * Auth domain errors. Typed so callers (and the UI) can branch on them, and so
 * authentication failures stay generic (no user enumeration).
 */

export class AuthenticationError extends Error {
  constructor(message = "Invalid credentials.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "AuthorizationError";
  }
}
