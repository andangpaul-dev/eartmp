/**
 * ClockPort — an application port abstracting "now".
 *
 * Use-cases that need the current time depend on this interface instead of
 * calling Date.now() directly, so time-dependent behaviour stays deterministic
 * and testable (a fake clock is injected in tests). No implementation in
 * Phase 1 — the interface is established for later phases.
 */
export interface ClockPort {
  now(): Date;
}
