import { describe, it, expect, beforeEach } from "vitest";
import { SecretBox } from "../../src/infrastructure/crypto/SecretBox";
import { Argon2KeyDerivationService } from "../../src/infrastructure/crypto/Argon2KeyDerivationService";
import { SealedSigningKeyProvider } from "../../src/infrastructure/crypto/SealedSigningKeyProvider";
import { CryptoSignatureService } from "../../src/infrastructure/crypto/CryptoSignatureService";
import { ChangeKeyPassphrase } from "../../src/application/use-cases/security/ChangeKeyPassphrase";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { SecurityError } from "../../src/domain/errors/security";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { InMemorySettingRepository } from "../config/fakes";

const PASS = "operator passphrase";
const admin = SessionContext.create("a", "ADMIN", ["security.manage"]);
const registry = buildDefaultRegistry();
const box = new SecretBox(new Argon2KeyDerivationService());

let settings: InMemorySettingRepository;
let keypair: { publicKeyPem: string; privateKeyPem: string };

beforeEach(async () => {
  keypair = CryptoSignatureService.generateKeypair();
  const sealed = await box.seal(keypair.privateKeyPem, PASS);
  settings = new InMemorySettingRepository({
    [SETTING_KEYS.transcriptPublicKey]: registry.serialize(
      SETTING_KEYS.transcriptPublicKey,
      keypair.publicKeyPem,
    ),
    [SETTING_KEYS.transcriptPrivateKey]: registry.serialize(
      SETTING_KEYS.transcriptPrivateKey,
      sealed,
    ),
  });
});

describe("SealedSigningKeyProvider", () => {
  it("opens the sealed key and yields a working signer", async () => {
    const signer = await new SealedSigningKeyProvider(
      settings,
      registry,
      box,
    ).getSigner(PASS);
    const { signature } = signer.sign("payload");
    expect(signer.verify("payload", signature)).toBe(true);
  }, 30000);

  it("throws on the wrong passphrase (before signing)", async () => {
    await expect(
      new SealedSigningKeyProvider(settings, registry, box).getSigner("nope"),
    ).rejects.toBeInstanceOf(SecurityError);
  }, 30000);
});

describe("ChangeKeyPassphrase", () => {
  it("re-seals under a new passphrase (old fails, new works, key unchanged)", async () => {
    const provider = new SealedSigningKeyProvider(settings, registry, box);
    const audit = new CapturingAudit();
    await new ChangeKeyPassphrase(settings, registry, box, audit).execute(
      { oldPassphrase: PASS, newPassphrase: "new-pass" },
      admin,
    );
    // new passphrase opens; old no longer does
    await expect(provider.getSigner("new-pass")).resolves.toBeTruthy();
    await expect(provider.getSigner(PASS)).rejects.toBeInstanceOf(
      SecurityError,
    );
    // same underlying key: a signature still verifies against the public key
    const signer = await provider.getSigner("new-pass");
    const { signature } = signer.sign("z");
    expect(signer.verify("z", signature)).toBe(true);
  }, 30000);

  it("rejects a wrong current passphrase", async () => {
    await expect(
      new ChangeKeyPassphrase(
        settings,
        registry,
        box,
        new CapturingAudit(),
      ).execute({ oldPassphrase: "wrong", newPassphrase: "x" }, admin),
    ).rejects.toBeInstanceOf(SecurityError);
  }, 30000);

  it("never records secrets in the audit entry (redaction)", async () => {
    const audit = new CapturingAudit();
    await new ChangeKeyPassphrase(settings, registry, box, audit).execute(
      { oldPassphrase: PASS, newPassphrase: "secret-new-pass" },
      admin,
    );
    const dump = JSON.stringify(audit.entries);
    expect(dump).toContain("CHANGE_KEY_PASSPHRASE");
    expect(dump).not.toContain("secret-new-pass");
    expect(dump).not.toContain(PASS);
    expect(dump).not.toContain("PRIVATE KEY");
  }, 30000);

  it("requires security.manage", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["settings.read"]);
    await expect(
      authorize(
        new ChangeKeyPassphrase(settings, registry, box, new CapturingAudit()),
        { oldPassphrase: PASS, newPassphrase: "x" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
