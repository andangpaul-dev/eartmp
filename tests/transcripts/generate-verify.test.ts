import { describe, it, expect, beforeEach } from "vitest";
import { GenerateTranscript } from "../../src/application/use-cases/transcripts/GenerateTranscript";
import {
  VerifyTranscript,
  ApproveTranscript,
} from "../../src/application/use-cases/transcripts/VerifyTranscript";
import { CryptoSignatureService } from "../../src/infrastructure/crypto/CryptoSignatureService";
import { TranscriptError } from "../../src/domain/errors/transcript";
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

  it("produces a verifiable signature", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    expect((await verify.execute({ transcriptId: t.id }, admin)).valid).toBe(
      true,
    );
  });

  it("verification FAILS when the snapshot is tampered", async () => {
    const t = await generate.execute({ studentId: "s1" }, admin);
    store.rows[0]!.snapshot = store.rows[0]!.snapshot.replace(
      "Ada Lovelace",
      "Mallory",
    );
    expect((await verify.execute({ transcriptId: t.id }, admin)).valid).toBe(
      false,
    );
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
