/**
 * Prisma-backed transcript store — DEV-ONLY adapter (ADR-007; replaced by the
 * Tauri-SQL data layer in the shell phase). Numbering expands the institution
 * rule with a count-based sequence (single-operator v1).
 */
import type { PrismaClient } from "@prisma/client";
import { expandNumberRule } from "../../domain/services/TranscriptNumber";
import { UniqueConstraintError } from "../../domain/errors/persistence";
import type {
  TranscriptStore,
  StoredTranscript,
  NewTranscript,
  TranscriptTemplateStore,
  StoredTemplate,
  NewTemplate,
} from "../../domain/repositories/transcripts";

type Row = {
  id: string;
  transcriptNumber: string;
  studentId: string;
  templateId: string;
  type: string;
  snapshot: string;
  verificationHash: string;
  status: string;
  remarks: string | null;
};

function toTranscript(r: Row): StoredTranscript {
  return {
    id: r.id,
    transcriptNumber: r.transcriptNumber,
    studentId: r.studentId,
    templateId: r.templateId,
    type: r.type,
    snapshot: r.snapshot,
    verificationHash: r.verificationHash,
    status: r.status,
    remarks: r.remarks ?? undefined,
  };
}

export class PrismaTranscriptRepository implements TranscriptStore {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewTranscript): Promise<StoredTranscript> {
    try {
      const r = await this.db.transcript.create({ data });
      return toTranscript(r);
    } catch (e) {
      // P2002 = unique-constraint violation. The transcriptNumber is the only
      // user-facing unique key here; surface it typed so the caller can retry a
      // raced number rather than failing the issue.
      const meta = e as { code?: string; meta?: { target?: unknown } };
      if (meta?.code === "P2002") {
        const target = meta.meta?.target;
        const field = Array.isArray(target)
          ? String(target[0])
          : typeof target === "string"
            ? target
            : undefined;
        throw new UniqueConstraintError(field ?? "transcriptNumber");
      }
      throw e;
    }
  }
  async findById(id: string): Promise<StoredTranscript | null> {
    const r = await this.db.transcript.findFirst({
      where: { id, deletedAt: null },
    });
    return r ? toTranscript(r) : null;
  }
  async findByNumber(
    transcriptNumber: string,
  ): Promise<StoredTranscript | null> {
    const r = await this.db.transcript.findFirst({
      where: { transcriptNumber, deletedAt: null },
    });
    return r ? toTranscript(r) : null;
  }
  async findByStudent(studentId: string): Promise<StoredTranscript[]> {
    const rows = await this.db.transcript.findMany({
      where: { studentId, deletedAt: null },
      orderBy: { generatedAt: "asc" },
    });
    return rows.map(toTranscript);
  }
  async updateStatus(id: string, status: string): Promise<StoredTranscript> {
    const r = await this.db.transcript.update({
      where: { id },
      data: { status },
    });
    return toTranscript(r);
  }
  async nextTranscriptNumber(rule: string): Promise<string> {
    const seq = (await this.db.transcript.count()) + 1;
    return expandNumberRule(rule, new Date().getFullYear(), seq);
  }
}

export class PrismaTranscriptTemplateRepository implements TranscriptTemplateStore {
  constructor(private readonly db: PrismaClient) {}
  private map(r: {
    id: string;
    name: string;
    version: number;
    layout: string;
    isDefault: boolean;
  }): StoredTemplate {
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      layout: r.layout,
      isDefault: r.isDefault,
    };
  }
  async findDefault(): Promise<StoredTemplate | null> {
    const r = await this.db.transcriptTemplate.findFirst({
      where: { isDefault: true, deletedAt: null },
    });
    return r ? this.map(r) : null;
  }
  async findById(id: string): Promise<StoredTemplate | null> {
    const r = await this.db.transcriptTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    return r ? this.map(r) : null;
  }
  async list(): Promise<StoredTemplate[]> {
    const rows = await this.db.transcriptTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => this.map(r));
  }
  async findByName(name: string): Promise<StoredTemplate | null> {
    const r = await this.db.transcriptTemplate.findFirst({
      where: { name, deletedAt: null },
    });
    return r ? this.map(r) : null;
  }
  async create(data: NewTemplate): Promise<StoredTemplate> {
    const r = await this.db.transcriptTemplate.create({
      data: { name: data.name, layout: data.layout, isDefault: data.isDefault },
    });
    return this.map(r);
  }
  async update(
    id: string,
    data: { name?: string; layout?: string; version: number },
  ): Promise<StoredTemplate> {
    const r = await this.db.transcriptTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.layout !== undefined ? { layout: data.layout } : {}),
        version: data.version,
      },
    });
    return this.map(r);
  }
  async softDelete(id: string): Promise<void> {
    await this.db.transcriptTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
  async setDefault(id: string): Promise<void> {
    await this.db.$transaction([
      this.db.transcriptTemplate.updateMany({
        where: { isDefault: true, deletedAt: null },
        data: { isDefault: false },
      }),
      this.db.transcriptTemplate.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }
  async countTranscriptsUsing(id: string): Promise<number> {
    return this.db.transcript.count({
      where: { templateId: id, deletedAt: null },
    });
  }
}
