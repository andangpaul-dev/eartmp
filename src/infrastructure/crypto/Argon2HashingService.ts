/**
 * Argon2HashingService — Argon2id implementation of HashingPort.
 *
 * Uses @node-rs/argon2 (portable prebuilt bindings) for dev/test. Under ADR-007
 * the production runtime impl may be the Tauri/Rust Argon2 behind the same port.
 * Cost parameters are injectable (AD2.3) so they can be raised over time via
 * Setting; the defaults are a reasonable interactive-login baseline.
 */
import { Algorithm, hash, verify } from "@node-rs/argon2";
import type { HashingPort } from "../../application/ports/HashingPort";

export interface Argon2Params {
  memoryCost: number; // KiB
  timeCost: number; // iterations
  parallelism: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19456, // ~19 MiB
  timeCost: 3,
  parallelism: 1,
};

export class Argon2HashingService implements HashingPort {
  constructor(private readonly params: Argon2Params = DEFAULT_ARGON2_PARAMS) {}

  hash(plain: string): Promise<string> {
    return hash(plain, {
      algorithm: Algorithm.Argon2id,
      memoryCost: this.params.memoryCost,
      timeCost: this.params.timeCost,
      parallelism: this.params.parallelism,
    });
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Malformed/foreign hash → not a match, never throw to the caller.
      return false;
    }
  }
}
