/**
 * Phase F — per-institution transcript signing keys. An institution may own a
 * dedicated keypair (namespaced settings); otherwise it falls back to the shared
 * global key. Covers: provisioning/rotation scoped per institution + scope
 * guards, key isolation (one institution can't verify another's signature), and
 * the global-key fallback.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ProvisionSigningKey } from "../../src/application/use-cases/security/ProvisionSigningKey";
import { ChangeKeyPassphrase } from "../../src/application/use-cases/security/ChangeKeyPassphrase";
import { CryptoSignatureService } from "../../src/infrastructure/crypto/CryptoSignatureService";
import { SealedSigningKeyProvider } from "../../src/infrastructure/crypto/SealedSigningKeyProvider";
import { SecretBox } from "../../src/infrastructure/crypto/SecretBox";
import { Argon2KeyDerivationService } from "../../src/infrastructure/crypto/Argon2KeyDerivationService";
import {
  writeSigningKeys,
  resolveSigningPublic,
  hasOwnSigningKey,
  namespacedKey,
} from "../../src/domain/settings/signingKeys";
import {
  buildDefaultRegistry,
  SETTING_KEYS,
} from "../../src/domain/settings/SettingsRegistry";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SecurityError } from "../../src/domain/errors/security";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { InMemorySettingRepository } from "../config/fakes";
import { CapturingAudit } from "../auth/fakes";
import type { SecretSealerPort } from "../../src/application/ports/SecretSealerPort";
import type { SigningKeyFactoryPort } from "../../src/application/ports/SigningKeyFactoryPort";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "security.manage",
]);
const scopedA = SessionContext.create(
  "r",
  "REGISTRAR",
  ["security.manage"],
  "instA",
);

// Deterministic sealer: the "sealed" value is just a tagged string.
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
let provision: ProvisionSigningKey;

beforeEach(() => {
  settings = new InMemorySettingRepository();
  registry = buildDefaultRegistry();
  audit = new CapturingAudit();
  provision = new ProvisionSigningKey(
    settings,
    registry,
    sealer,
    factory,
    audit,
  );
});

describe("ProvisionSigningKey (per institution)", () => {
  it("stores a dedicated key under namespaced settings, leaving the global key untouched", async () => {
    const out = await provision.execute(
      { passphrase: "passphrase1", institutionId: "instA" },
      admin,
    );
    expect(out).toEqual({ provisioned: true });
    expect(
      await settings.getRaw(
        namespacedKey(SETTING_KEYS.transcriptPublicKey, "instA"),
      ),
    ).toBe("PUB");
    expect(
      await settings.getRaw(
        namespacedKey(SETTING_KEYS.transcriptPrivateKey, "instA"),
      ),
    ).toBe("sealed:passphrase1:PRIV");
    // The shared global key is not created as a side effect.
    expect(await settings.getRaw(SETTING_KEYS.transcriptPublicKey)).toBeNull();
    expect(audit.entries.at(-1)).toMatchObject({
      action: "PROVISION",
      entity: "SigningKey",
    });
  });

  it("a first dedicated key needs no replaceExisting even when a global key exists", async () => {
    await provision.execute({ passphrase: "globalpass" }, admin); // global key
    await expect(
      provision.execute(
        { passphrase: "instpass1", institutionId: "instA" },
        admin,
      ),
    ).resolves.toEqual({ provisioned: true });
    // …but replacing the institution's own key now needs the flag.
    await expect(
      provision.execute(
        { passphrase: "instpass2", institutionId: "instA" },
        admin,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("a scoped operator may provision only its own institution's key", async () => {
    await expect(
      provision.execute(
        { passphrase: "passphrase1", institutionId: "instB" },
        scopedA,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // …and may not touch the shared/default global key.
    await expect(
      provision.execute({ passphrase: "passphrase1" }, scopedA),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // Its own institution is allowed.
    await expect(
      provision.execute(
        { passphrase: "passphrase1", institutionId: "instA" },
        scopedA,
      ),
    ).resolves.toEqual({ provisioned: true });
  });
});

describe("ChangeKeyPassphrase (per institution)", () => {
  it("re-seals an institution's dedicated key, leaving its public key unchanged", async () => {
    await writeSigningKeys(
      settings,
      registry,
      "instA",
      "PUBA",
      "sealed:old:PRIVA",
    );
    await new ChangeKeyPassphrase(settings, registry, sealer, audit).execute(
      {
        oldPassphrase: "old",
        newPassphrase: "newpass",
        institutionId: "instA",
      },
      admin,
    );
    expect(
      await settings.getRaw(
        namespacedKey(SETTING_KEYS.transcriptPrivateKey, "instA"),
      ),
    ).toBe("sealed:newpass:PRIVA");
    expect(
      await settings.getRaw(
        namespacedKey(SETTING_KEYS.transcriptPublicKey, "instA"),
      ),
    ).toBe("PUBA");
  });

  it("refuses to rotate an institution that has no dedicated key", async () => {
    await expect(
      new ChangeKeyPassphrase(settings, registry, sealer, audit).execute(
        {
          oldPassphrase: "x",
          newPassphrase: "newpass",
          institutionId: "instA",
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(SecurityError);
  });

  it("a scoped operator cannot rotate another institution's key", async () => {
    await writeSigningKeys(
      settings,
      registry,
      "instB",
      "PUBB",
      "sealed:old:PRIVB",
    );
    await expect(
      new ChangeKeyPassphrase(settings, registry, sealer, audit).execute(
        {
          oldPassphrase: "old",
          newPassphrase: "newpass",
          institutionId: "instB",
        },
        scopedA,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("key isolation + global fallback", () => {
  it("a signature from one institution verifies with its own key, not another's", async () => {
    const a = CryptoSignatureService.generateKeypair();
    const b = CryptoSignatureService.generateKeypair();
    await writeSigningKeys(
      settings,
      registry,
      "instA",
      a.publicKeyPem,
      "sealedA",
    );
    await writeSigningKeys(
      settings,
      registry,
      "instB",
      b.publicKeyPem,
      "sealedB",
    );

    const sig = new CryptoSignatureService(
      a.privateKeyPem,
      a.publicKeyPem,
    ).sign("snapshot");

    const verA = CryptoSignatureService.verifier(
      await resolveSigningPublic(settings, registry, "instA"),
    );
    const verB = CryptoSignatureService.verifier(
      await resolveSigningPublic(settings, registry, "instB"),
    );
    expect(verA.verify("snapshot", sig.signature)).toBe(true);
    expect(verB.verify("snapshot", sig.signature)).toBe(false);
  });

  it("an institution with no dedicated key resolves the global key", async () => {
    const g = CryptoSignatureService.generateKeypair();
    await settings.setRaw(
      SETTING_KEYS.transcriptPublicKey,
      registry.serialize(SETTING_KEYS.transcriptPublicKey, g.publicKeyPem),
    );
    expect(await hasOwnSigningKey(settings, "instNoKey")).toBe(false);
    expect(await resolveSigningPublic(settings, registry, "instNoKey")).toBe(
      g.publicKeyPem,
    );
  });

  it("getVerifier yields null when nothing is provisioned, and a verify-only signer can't sign", async () => {
    const provider = new SealedSigningKeyProvider(
      settings,
      registry,
      new SecretBox(new Argon2KeyDerivationService()),
    );
    expect(await provider.getVerifier("none")).toBeNull();
    const g = CryptoSignatureService.generateKeypair();
    expect(() =>
      CryptoSignatureService.verifier(g.publicKeyPem).sign("x"),
    ).toThrow(/verify-only/);
  });
});
