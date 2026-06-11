/**
 * Canonical transcript repository port (Phase 12). Operates on stored
 * transcripts (snapshot + signature JSON). The legacy `TranscriptRepository` in
 * `./index.ts` is superseded by this.
 */

export interface StoredTranscript {
  id: string;
  transcriptNumber: string;
  studentId: string;
  templateId: string;
  type: string;
  snapshot: string; // frozen JSON (data + resolved layout)
  verificationHash: string; // JSON { signature, keyId }
  status: string; // DRAFT | APPROVED | LOCKED
  remarks?: string;
}

export interface NewTranscript {
  transcriptNumber: string;
  studentId: string;
  templateId: string;
  type: string;
  snapshot: string;
  verificationHash: string;
  status: string;
}

export interface TranscriptStore {
  create(data: NewTranscript): Promise<StoredTranscript>;
  findById(id: string): Promise<StoredTranscript | null>;
  findByNumber(transcriptNumber: string): Promise<StoredTranscript | null>;
  findByStudent(studentId: string): Promise<StoredTranscript[]>;
  updateStatus(id: string, status: string): Promise<StoredTranscript>;
  /** Expand the institution numbering rule to the next unique number. */
  nextTranscriptNumber(rule: string): Promise<string>;
}

export interface StoredTemplate {
  id: string;
  name: string;
  version: number;
  layout: string; // JSON block tree
  isDefault: boolean;
}

export interface TranscriptTemplateRepository {
  findDefault(): Promise<StoredTemplate | null>;
  findById(id: string): Promise<StoredTemplate | null>;
}

export interface NewTemplate {
  name: string;
  layout: string; // JSON block tree
  isDefault: boolean;
}

/** Full management port (Phase 15) — extends the read port. */
export interface TranscriptTemplateStore extends TranscriptTemplateRepository {
  list(): Promise<StoredTemplate[]>;
  findByName(name: string): Promise<StoredTemplate | null>;
  create(data: NewTemplate): Promise<StoredTemplate>;
  update(
    id: string,
    data: { name?: string; layout?: string; version: number },
  ): Promise<StoredTemplate>;
  softDelete(id: string): Promise<void>;
  /** Make this template the only default. */
  setDefault(id: string): Promise<void>;
  /** Count issued transcripts referencing this template (guarded delete). */
  countTranscriptsUsing(id: string): Promise<number>;
}
