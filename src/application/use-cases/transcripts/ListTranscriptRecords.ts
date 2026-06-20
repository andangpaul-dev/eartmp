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
  // Browse filters (per faculty/department/programme). A faculty-scoped operator
  // is constrained to their assigned faculties regardless of what's requested.
  facultyId?: string;
  departmentId?: string;
  programmeId?: string;
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
    session: SessionContext,
  ): Promise<TranscriptRecord[]> {
    // Effective faculty scope: a faculty-scoped operator is limited to their
    // assigned faculties; a requested faculty must be within that set (a scoped
    // user cannot widen past it). An unscoped operator may filter freely.
    let facultyIds: string[] | undefined;
    if (session.isFacultyScoped) {
      facultyIds =
        input.facultyId && session.facultyIds.includes(input.facultyId)
          ? [input.facultyId]
          : [...session.facultyIds];
    } else if (input.facultyId) {
      facultyIds = [input.facultyId];
    }

    // Tenant isolation: a scoped operator only sees their institution's records.
    const records = await this.transcripts.listRecords({
      ...(input.status ? { status: input.status } : {}),
      ...(session.isGlobal ? {} : { institutionId: session.institutionId }),
      ...(facultyIds ? { facultyIds } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.programmeId ? { programmeId: input.programmeId } : {}),
    });
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
