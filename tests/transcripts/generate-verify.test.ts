import { describe, it, expect, beforeEach } from "vitest";
import { GenerateTranscript } from "../../src/application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
  LockTranscript,
  RevokeTranscript,
} from "../../src/application/use-cases/transcripts/VerifyTranscript";
import { CryptoSignatureService } from "../../src/infrastructure/crypto/CryptoSignatureService";
import { TranscriptError } from "../../src/domain/errors/transcript";
import { UniqueConstraintError } from "../../src/domain/errors/persistence";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type {
  TranscriptStore,
  TranscriptTemplateRepository,
  StoredTranscript,
  NewTranscript,
  StoredTemplate,
} from "../../src/domain/repositories/transcripts";
import { expandNumberRule } from "../../src/domain/services/TranscriptNumber";
import type { InstitutionRepository } from "../../src/domain/repositories/config";
import type { Institution } from "../../src/domain/entities/institution";
import type { ReportDataAssembler } from "../../src/application/use-cases/transcripts/BuildReportData";
import type { ReportData } from "../../src/domain/services/TranscriptReportData";
import type { ClockPort } from "../../src/application/ports/ClockPort";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "transcripts.read",
  "transcripts.generate",
  "transcripts.approve",
]);

class FakeStore implements TranscriptStore {
  rows: StoredTranscript[] = [];
  private seq = 0;
  async create(d: NewTranscript) {
    const t: StoredTranscript = { id: `t${++this.seq}`, ...d };
    this.rows.push(t);
    return { ...t };
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByNumber(n: string) {
    return this.rows.find((r) => r.transcriptNumber === n) ?? null;
  }
  async findByStudent(s: string) {
    return this.rows.filter((r) => r.studentId === s);
  }
  async updateStatus(id: string, status: string) {
    const r = this.rows.find((x) => x.id === id)!;
    r.status = status;
    return { ...r };
  }
  async nextTranscriptNumber(rule: string) {
    return expandNumberRule(rule, 2026, this.rows.length + 1);
  }
  async listRecords(filter?: { status?: string }) {
    return this.rows
      .filter((r) => !filter?.status || r.status === filter.status)
      .map((r) => ({
        id: r.id,
        transcriptNumber: r.transcriptNumber,
        studentId: r.studentId,
        matricNumber: "M/1",
        studentName: "Ada Lovelace",
        type: r.type,
        status: r.status,
        generatedAt: "2026-01-01T00:00:00.000Z",
      }));
  }
}

const template: StoredTemplate = {
  id: "tpl1",
  name: "Official",
  version: 1,
  isDefault: true,
  layout: JSON.stringify({
    blocks: [
      {
        type: "fieldGrid",
        fields: [{ label: "Name", bind: "student.fullName" }],
      },
      { type: "summary", fields: [{ label: "CGPA", bind: "summary.cgpa" }] },
      { type: "qr", bind: "verification.qrPayload" },
    ],
  }),
};
const templates: TranscriptTemplateRepository = {
  async findDefault() {
    return template;
  },
  async findById() {
    return template;
  },
};

const institution: Institution = {
  id: "i1",
  name: "Example University",
  calendarType: "SEMESTER",
  transcriptNumberRule: "TR-{year}-{seq:000000}",
};
const institutions: InstitutionRepository = {
  async get() {
    return institution;
  },
  async update() {
    return institution;
  },
};

const assembler: ReportDataAssembler = {
  async assemble(_studentId, transcriptNumber): Promise<ReportData> {
    return {
      institution: { name: "Example University" },
      student: { matricNumber: "M/1", fullName: "Ada Lovelace" },
      sessions: [],
      summary: { cgpa: 3.6, totalCreditsEarned: 5, standing: "First Class" },
      signatures: [{ role: "Registrar" }],
      verification: { transcriptNumber, qrPayload: transcriptNumber },
      issuedAt: "2026-01-01T00:00:00.000Z",
    };
  },
};

const clock: ClockPort = { now: () => new Date("2026-01-01T00:00:00.000Z") };

let store: FakeStore;
let signer: CryptoSignatureService;
let generate: GenerateTranscript;
let verify: VerifyTranscript;
let audit: CapturingAudit;

beforeEach(() => {
  store = new FakeStore();
  const kp = CryptoSignatureService.generateKeypair();
  signer = new CryptoSignatureService(kp.privateKeyPem, kp.publicKeyPem);
  audit = new CapturingAudit();
  generate = new GenerateTranscript(
    store,
    templates,
    institutions,
    assembler,
    signer,
    clock,
    audit,
  );
  verify = new VerifyTranscript(store, signer);
});

describe("GenerateTranscript", () => {
  it("generates a numbered, signed DRAFT and audits", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    expect(t.transcriptNumber).toBe("TR-2026-000001");
    expect(t.status).toBe("DRAFT");
    expect(audit.entries.at(-1)).toMatchObject({ action: "GENERATE" });
  });

  it("a DRAFT has a valid signature but is not an issued (valid) transcript", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    const r = await verify.execute({ transcriptId: t.id }, admin);
    expect(r.signatureValid).toBe(true); // signature checks out
    expect(r.valid).toBe(false); // …but a DRAFT isn't an official issue
    expect(r.status).toBe("DRAFT");
  });

  it("retries the number when a concurrent issue takes it (UNIQUE race)", async () => {
    // Simulate a raced number: the first create collides, the retry succeeds.
    let throwOnce = true;
    const original = store.create.bind(store);
    store.create = async (d: NewTranscript) => {
      if (throwOnce) {
        throwOnce = false;
        throw new UniqueConstraintError("transcriptNumber");
      }
      return original(d);
    };
    const t = await generate.execute({ studentId: "s1" }, admin);
    // First derived number was TR-2026-000001 (count 0 → seq 1); after the
    // collision the loser re-derives — still seq 1 here since nothing persisted,
    // but the point is the issue succeeds rather than throwing.
    expect(t.status).toBe("DRAFT");
    expect(t.transcriptNumber).toMatch(/^TR-2026-\d{6}$/);
    expect(throwOnce).toBe(false);
  });

  it("gives up after repeated number collisions", async () => {
    store.create = async () => {
      throw new UniqueConstraintError("transcriptNumber");
    };
    await expect(
      generate.execute({ studentId: "s1" }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });

  it("verification FAILS when the snapshot is tampered", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    store.rows[0]!.snapshot = store.rows[0]!.snapshot.replace(
      "Ada Lovelace",
      "Mallory",
    );
    const r = await verify.execute({ transcriptId: t.id }, admin);
    expect(r.signatureValid).toBe(false);
    expect(r.valid).toBe(false);
  });
});

describe("Lock / Revoke + verify depth", () => {
  it("APPROVED → LOCKED is verifiably valid; revoked is not", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    await new ApproveTranscript(store, audit).execute(
      { transcriptId: t.id },
      admin,
    );
    expect((await verify.execute({ transcriptId: t.id }, admin)).valid).toBe(
      true,
    );

    await new LockTranscript(store, audit).execute(
      { transcriptId: t.id },
      admin,
    );
    const locked = await verify.execute({ transcriptId: t.id }, admin);
    expect(locked.status).toBe("LOCKED");
    expect(locked.valid).toBe(true);

    await new RevokeTranscript(store, audit).execute(
      { transcriptId: t.id, reason: "superseded" },
      admin,
    );
    const revoked = await verify.execute({ transcriptId: t.id }, admin);
    expect(revoked.revoked).toBe(true);
    expect(revoked.valid).toBe(false); // signature still checks, but revoked
    expect(revoked.signatureValid).toBe(true);
  });

  it("Lock rejects a DRAFT; Revoke rejects a DRAFT", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    await expect(
      new LockTranscript(store, audit).execute({ transcriptId: t.id }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
    await expect(
      new RevokeTranscript(store, audit).execute({ transcriptId: t.id }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });

  it("detects a rotated signing key (key mismatch)", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    await new ApproveTranscript(store, audit).execute(
      { transcriptId: t.id },
      admin,
    );
    // Verify with a DIFFERENT key than the one that signed.
    const other = CryptoSignatureService.generateKeypair();
    const otherSigner = new CryptoSignatureService(
      other.privateKeyPem,
      other.publicKeyPem,
    );
    const r = await new VerifyTranscript(store, otherSigner).execute(
      { transcriptId: t.id },
      admin,
    );
    expect(r.keyMatches).toBe(false);
    expect(r.valid).toBe(false);
  });
});

describe("ApproveTranscript", () => {
  it("moves DRAFT → APPROVED and rejects re-approval", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    const approve = new ApproveTranscript(store, audit);
    const approved = await approve.execute({ transcriptId: t.id }, admin);
    expect(approved.status).toBe("APPROVED");
    await expect(
      approve.execute({ transcriptId: t.id }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });
});
