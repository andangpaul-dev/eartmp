import { describe, it, expect } from "vitest";
import { ExportTranscript } from "../../src/application/use-cases/transcripts/ExportTranscript";
import { TranscriptError } from "../../src/domain/errors/transcript";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type {
  TranscriptStore,
  StoredTranscript,
} from "../../src/domain/repositories/transcripts";
import type {
  DocumentRendererPort,
  RenderOptions,
} from "../../src/application/ports/DocumentRendererPort";
import type { ResolvedDoc } from "../../src/domain/services/TranscriptReportData";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "transcripts.read",
]);

const snapshot = JSON.stringify({
  resolvedDoc: {
    pageSize: "A4",
    blocks: [{ type: "title", text: "T" }],
  } as ResolvedDoc,
});

function storeWith(status: string, snap = snapshot): TranscriptStore {
  const t: StoredTranscript = {
    id: "t1",
    transcriptNumber: "TR-1",
    studentId: "s1",
    templateId: "tpl",
    type: "ACADEMIC_TRANSCRIPT",
    snapshot: snap,
    verificationHash: "{}",
    status,
  };
  return {
    async findById(id) {
      return id === "t1" ? t : null;
    },
    async findByNumber() {
      return null;
    },
    async findByStudent() {
      return [];
    },
    async create() {
      return t;
    },
    async updateStatus() {
      return t;
    },
    async nextTranscriptNumber() {
      return "TR-1";
    },
    async listRecords() {
      return [];
    },
  };
}

class FakeRenderer implements DocumentRendererPort {
  lastOpts?: RenderOptions;
  async render(_doc: ResolvedDoc, opts: RenderOptions = {}) {
    this.lastOpts = opts;
    return new Uint8Array([1, 2, 3]);
  }
}

describe("ExportTranscript", () => {
  it("rejects an official export of a DRAFT", async () => {
    const uc = new ExportTranscript(
      storeWith("DRAFT"),
      new FakeRenderer(),
      new CapturingAudit(),
    );
    await expect(
      uc.execute({ transcriptId: "t1" }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });

  it("allows a watermarked DRAFT preview", async () => {
    const renderer = new FakeRenderer();
    const audit = new CapturingAudit();
    const uc = new ExportTranscript(storeWith("DRAFT"), renderer, audit);
    const out = await uc.execute({ transcriptId: "t1", preview: true }, admin);
    expect(out.filename).toBe("TR-1.pdf");
    expect(out.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(renderer.lastOpts).toMatchObject({ watermark: "DRAFT — NOT VALID" });
    expect(audit.entries.at(-1)).toMatchObject({ action: "EXPORT" });
  });

  it("exports an APPROVED transcript with no watermark", async () => {
    const renderer = new FakeRenderer();
    const uc = new ExportTranscript(
      storeWith("APPROVED"),
      renderer,
      new CapturingAudit(),
    );
    await uc.execute({ transcriptId: "t1" }, admin);
    expect(renderer.lastOpts).toEqual({});
  });

  it("throws on a corrupt snapshot", async () => {
    const uc = new ExportTranscript(
      storeWith("APPROVED", "{not json"),
      new FakeRenderer(),
      new CapturingAudit(),
    );
    await expect(uc.execute({ transcriptId: "t1" }, admin)).rejects.toThrow(
      /corrupt/,
    );
  });

  it("throws when the transcript is missing", async () => {
    const uc = new ExportTranscript(
      storeWith("APPROVED"),
      new FakeRenderer(),
      new CapturingAudit(),
    );
    await expect(
      uc.execute({ transcriptId: "ghost" }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });
});
