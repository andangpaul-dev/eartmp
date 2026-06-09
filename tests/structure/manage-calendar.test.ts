import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateSession,
  SetCurrentSession,
  CreateSemester,
  ListSessions,
} from "../../src/application/use-cases/structure/ManageCalendar";
import { StructureError } from "../../src/domain/errors/structure";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeSessionRepo, FakeSemesterRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "structure.read",
  "structure.manage",
]);

let sessions: FakeSessionRepo;
let semesters: FakeSemesterRepo;
let audit: CapturingAudit;

beforeEach(() => {
  sessions = new FakeSessionRepo();
  semesters = new FakeSemesterRepo();
  audit = new CapturingAudit();
});

describe("sessions", () => {
  it("creates a session and rejects a duplicate name", async () => {
    const uc = new CreateSession(sessions, audit);
    const s = await uc.execute({ name: "2025/2026" }, admin);
    expect(s.isCurrent).toBe(false);
    await expect(
      uc.execute({ name: "2025/2026" }, admin),
    ).rejects.toBeInstanceOf(StructureError);
  });

  it("setting current clears the flag on others (single current)", async () => {
    const create = new CreateSession(sessions, audit);
    const a = await create.execute({ name: "A" }, admin);
    const b = await create.execute({ name: "B" }, admin);
    const setCurrent = new SetCurrentSession(sessions, audit);
    await setCurrent.execute({ id: a.id }, admin);
    await setCurrent.execute({ id: b.id }, admin);
    const all = await new ListSessions(sessions).execute({}, admin);
    expect(all.filter((s) => s.isCurrent).map((s) => s.name)).toEqual(["B"]);
  });
});

describe("semesters", () => {
  it("requires a live session and enforces unique rank", async () => {
    const session = await new CreateSession(sessions, audit).execute(
      { name: "2025/2026" },
      admin,
    );
    const uc = new CreateSemester(semesters, sessions, audit);
    await uc.execute({ name: "First", rank: 1, sessionId: session.id }, admin);
    await expect(
      uc.execute({ name: "Dup", rank: 1, sessionId: session.id }, admin),
    ).rejects.toThrow(/rank 1 already exists/);
    await expect(
      uc.execute({ name: "X", rank: 2, sessionId: "missing" }, admin),
    ).rejects.toThrow(/session does not exist/);
  });
});
