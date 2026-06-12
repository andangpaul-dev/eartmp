/**
 * Security domain error (sealing/unsealing secrets). Messages are deliberately
 * non-revealing — never echo key material or passphrases.
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}
