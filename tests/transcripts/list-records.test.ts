/**
 * ListTranscriptRecords — the cross-student registry: status filter is passed to
 * the store; free-text search filters in-memory over matric / name / number.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ListTranscriptRecords } from "../../src/application/use-cases/transcripts/ListTranscriptRecords";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  TranscriptStore,
  TranscriptRecord,
} from "../../src/domain/repositories/transcripts";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "transcripts.read",
]);

const RECORDS: TranscriptRecord[] = [
  {
    id: "t1",
    transcriptNumber: "TR-2026-000001",
    studentId: "s1",
    matricNumber: "M/1",
    studentName: "Ada Lovelace",
    type: "ACADEMIC_TRANSCRIPT",
    status: "LOCKED",
    generatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "t2",
    transcriptNumber: "TR-2026-000002",
    studentId: "s2",
    matricNumber: "M/2",
    studentName: "Grace Hopper",
    type: "ACADEMIC_TRANSCRIPT",
    status: "DRAFT",
    generatedAt: "2026-01-01T00:00:00.000Z",
  },
];

let lastFilter: { status?: string; institutionId?: string } | undefined;
const store = {
  async listRecords(filter?: { status?: string; institutionId?: string }) {
    lastFilter = filter;
    return RECORDS.filter((r) => !filter?.status || r.status === filter.status);
  },
} as unknown as TranscriptStore;

beforeEach(() => {
  lastFilter = undefined;
});

describe("ListTranscriptRecords", () => {
  it("returns all records when no filter is given", async () => {
    const uc = new ListTranscriptRecords(store);
    const out = await uc.execute({}, admin);
    expect(out).toHaveLength(2);
    // Global operator → no institution scoping.
    expect(lastFilter?.institutionId).toBeUndefined();
  });

  it("scopes records to the operator's institution (Phase D)", async () => {
    const scoped = SessionContext.create(
      "u",
      "REGISTRAR",
      ["transcripts.read"],
      "inst-9",
    );
    await new ListTranscriptRecords(store).execute({}, scoped);
    expect(lastFilter?.institutionId).toBe("inst-9");
  });

  it("passes the status filter through to the store", async () => {
    const uc = new ListTranscriptRecords(store);
    const out = await uc.execute({ status: "LOCKED" }, admin);
    expect(lastFilter).toEqual({ status: "LOCKED" });
    expect(out.map((r) => r.id)).toEqual(["t1"]);
  });

  it("searches by matric, name, or transcript number (case-insensitive)", async () => {
    const uc = new ListTranscriptRecords(store);
    expect(
      (await uc.execute({ search: "grace" }, admin)).map((r) => r.id),
    ).toEqual(["t2"]);
    expect(
      (await uc.execute({ search: "M/1" }, admin)).map((r) => r.id),
    ).toEqual(["t1"]);
    expect(
      (await uc.execute({ search: "000002" }, admin)).map((r) => r.id),
    ).toEqual(["t2"]);
    expect(await uc.execute({ search: "nobody" }, admin)).toHaveLength(0);
  });

  it("is denied through the seam without transcripts.read", async () => {
    const viewer = SessionContext.create("v", "VIEWER", []);
    await expect(
      authorize(new ListTranscriptRecords(store), {}, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
