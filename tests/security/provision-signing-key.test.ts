import { describe, it, expect, beforeEach } from "vitest";
import { ProvisionSigningKey } from "../../src/application/use-cases/security/ProvisionSigningKey";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SecurityError } from "../../src/domain/errors/security";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { SETTING_KEYS } from "../../src/domain/settings/SettingsRegistry";
import { buildDefaultRegistry } from "../../src/domain/settings/SettingsRegistry";
import { InMemorySettingRepository } from "../config/fakes";
import { CapturingAudit } from "../auth/fakes";
import type { SecretSealerPort } from "../../src/application/ports/SecretSealerPort";
import type { SigningKeyFactoryPort } from "../../src/application/ports/SigningKeyFactoryPort";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "security.manage",
]);

// Deterministic fakes: the "sealed" value is just a tagged string.
const sealer: SecretSealerPort = {
  async seal(secret, passphrase) {
    return `sealed:${passphrase}:${secret}`;
  },
  async open(sealed, passphrase) {
    const prefix = `sealed:${passphrase}:`;
    if (!sealed.startsWith(prefix)) throw new Error("bad passphrase");
    return sealed.slice(prefix.length);
  },
};
const factory: SigningKeyFactoryPort = {
  generateKeypair() {
    return { publicKeyPem: "PUB", privateKeyPem: "PRIV" };
  },
};

let settings: InMemorySettingRepository;
let registry: ReturnType<typeof buildDefaultRegistry>;
let audit: CapturingAudit;
let uc: ProvisionSigningKey;

beforeEach(() => {
  settings = new InMemorySettingRepository();
  registry = buildDefaultRegistry();
  audit = new CapturingAudit();
  uc = new ProvisionSigningKey(settings, registry, sealer, factory, audit);
});

describe("ProvisionSigningKey", () => {
  it("creates a key when none is provisioned, sealing the private key", async () => {
    const out = await uc.execute({ passphrase: "passphrase1" }, admin);
    expect(out).toEqual({ provisioned: true });
    expect(
      await settings.getRaw(SETTING_KEYS.transcriptPublicKey),
    ).toBeTruthy();
    const sealed = registry.deserialize(
      SETTING_KEYS.transcriptPrivateKey,
      (await settings.getRaw(SETTING_KEYS.transcriptPrivateKey))!,
    ) as string;
    expect(sealed).toBe("sealed:passphrase1:PRIV");
    expect(audit.entries.at(-1)).toMatchObject({
      action: "PROVISION",
      entity: "SigningKey",
    });
  });

  it("rejects a short passphrase", async () => {
    await expect(
      uc.execute({ passphrase: "short" }, admin),
    ).rejects.toBeInstanceOf(SecurityError);
  });

  it("refuses to overwrite an existing key without replaceExisting", async () => {
    await uc.execute({ passphrase: "passphrase1" }, admin);
    await expect(
      uc.execute({ passphrase: "passphrase2" }, admin),
    ).rejects.toThrow(/already exists/);
    // With the explicit flag it replaces.
    const out = await uc.execute(
      { passphrase: "passphrase2", replaceExisting: true },
      admin,
    );
    expect(out).toEqual({ provisioned: true });
  });

  it("is denied through the seam without security.manage", async () => {
    const viewer = SessionContext.create("v", "VIEWER", []);
    await expect(
      authorize(uc, { passphrase: "passphrase1" }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
