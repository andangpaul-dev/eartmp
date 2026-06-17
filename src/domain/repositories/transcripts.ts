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
  /** Issuing institution (resolved from the student); scopes numbering. */
  institutionId?: string;
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
  institutionId?: string;
}

/**
 * Cross-student registry row — a transcript enriched with the issuing student's
 * identity and its issue date, for the Records screen. A read model: it never
 * carries the snapshot/signature, only what the registry lists.
 */
export interface TranscriptRecord {
  id: string;
  transcriptNumber: string;
  studentId: string;
  matricNumber: string;
  studentName: string;
  type: string;
  status: string;
  generatedAt: string; // ISO
}

export interface TranscriptRecordFilter {
  status?: string;
  institutionId?: string;
}

export interface TranscriptStore {
  create(data: NewTranscript): Promise<StoredTranscript>;
  findById(id: string): Promise<StoredTranscript | null>;
  findByNumber(transcriptNumber: string): Promise<StoredTranscript | null>;
  findByStudent(studentId: string): Promise<StoredTranscript[]>;
  updateStatus(id: string, status: string): Promise<StoredTranscript>;
  /** Expand the institution numbering rule to the next unique number. When an
   *  institutionId is given, the sequence is scoped to that institution. */
  nextTranscriptNumber(rule: string, institutionId?: string): Promise<string>;
  /** All transcripts (newest first), enriched with student identity, for the
   *  Records registry. Optionally narrowed by status. */
  listRecords(filter?: TranscriptRecordFilter): Promise<TranscriptRecord[]>;
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
