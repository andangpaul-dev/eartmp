/**
 * ListTranscriptRecords — the cross-student transcript registry behind the
 * Records screen. Returns every treated transcript (newest first) enriched with
 * the student's identity, optionally narrowed by status and a free-text search
 * over matric number / name / transcript number. Read-only + permission-gated.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type {
  TranscriptStore,
  TranscriptRecord,
} from "../../../domain/repositories/transcripts";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ListTranscriptRecordsInput {
  status?: string;
  search?: string;
}

export class ListTranscriptRecords implements AuthorizedUseCase<
  ListTranscriptRecordsInput,
  TranscriptRecord[]
> {
  readonly name = "ListTranscriptRecords";
  readonly requiredPermissions = ["transcripts.read"];

  constructor(private readonly transcripts: TranscriptStore) {}

  async execute(
    input: ListTranscriptRecordsInput,
    _session: SessionContext,
  ): Promise<TranscriptRecord[]> {
    const records = await this.transcripts.listRecords(
      input.status ? { status: input.status } : undefined,
    );
    const q = input.search?.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.matricNumber.toLowerCase().includes(q) ||
        r.studentName.toLowerCase().includes(q) ||
        r.transcriptNumber.toLowerCase().includes(q),
    );
  }
}
