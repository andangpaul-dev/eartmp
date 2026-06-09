/**
 * HashingPort — password hashing abstraction (Argon2id in production).
 *
 * Use-cases depend on this interface, never on a concrete crypto library, so
 * the runtime implementation can move (e.g. a Rust/Tauri Argon2) without
 * touching application logic (architecture review ADR-004 / AD2.4).
 */
export interface HashingPort {
  /** Hash a plaintext password; returns an encoded hash string (with salt). */
  hash(plain: string): Promise<string>;
  /** Verify a plaintext password against an encoded hash. Never throws. */
  verify(plain: string, hash: string): Promise<boolean>;
}
