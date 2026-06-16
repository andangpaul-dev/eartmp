/**
 * Port for generating a fresh transcript-signing keypair. Keeps the keypair
 * algorithm (Ed25519, infrastructure) out of the application layer so
 * ProvisionSigningKey stays framework-free and testable.
 */
export interface GeneratedKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface SigningKeyFactoryPort {
  generateKeypair(): GeneratedKeypair;
}
