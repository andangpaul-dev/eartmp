/**
 * CryptoSigningKeyFactory — generates an Ed25519 transcript-signing keypair via
 * CryptoSignatureService. The infrastructure implementation of
 * SigningKeyFactoryPort.
 */
import type {
  SigningKeyFactoryPort,
  GeneratedKeypair,
} from "../../application/ports/SigningKeyFactoryPort";
import { CryptoSignatureService } from "./CryptoSignatureService";

export class CryptoSigningKeyFactory implements SigningKeyFactoryPort {
  generateKeypair(): GeneratedKeypair {
    return CryptoSignatureService.generateKeypair();
  }
}
