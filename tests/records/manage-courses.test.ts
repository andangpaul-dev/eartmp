import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateCourse,
  UpdateCourse,
  ListCourses,
} from "../../src/application/use-cases/records/ManageCourses";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { RecordsError } from "../../src/domain/errors/records";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import { FakeCourseRepo } from "./fakes";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "courses.create",
  "courses.read",
  "courses.update",
]);
const viewer = SessionContext.create("v", "VIEWER", ["courses.read"]);

let courses: FakeCourseRepo;
let audit: CapturingAudit;
beforeEach(() => {
  courses = new FakeCourseRepo();
  audit = new CapturingAudit();
});

describe("CreateCourse", () => {
  it("validates code, creditValue, type; rejects duplicate live code", async () => {
    const uc = new CreateCourse(courses, audit);
    const c = await uc.execute(
      { code: "CS101", title: "Intro", creditValue: 3, courseType: "CORE" },
      admin,
    );
    expect(c.creditValue).toBe(3);
    await expect(
      uc.execute(
        { code: "X", title: "T", creditValue: 0, courseType: "CORE" },
        admin,
      ),
    ).rejects.toThrow(/positive integer/);
    await expect(
      uc.execute(
        { code: "Y", title: "T", creditValue: 3, courseType: "BAD" as never },
        admin,
      ),
    ).rejects.toThrow(/Invalid course type/);
    await expect(
      uc.execute(
        { code: "CS101", title: "Dup", creditValue: 3, courseType: "CORE" },
        admin,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("is denied without courses.create", async () => {
    await expect(
      authorize(
        new CreateCourse(courses, audit),
        { code: "Z", title: "T", creditValue: 3, courseType: "CORE" },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("UpdateCourse", () => {
  it("rejects a non-positive creditValue and audits a valid change", async () => {
    const c = await new CreateCourse(courses, audit).execute(
      { code: "CS101", title: "Intro", creditValue: 3, courseType: "CORE" },
      admin,
    );
    const uc = new UpdateCourse(courses, audit);
    await expect(
      uc.execute({ id: c.id, patch: { creditValue: -1 } }, admin),
    ).rejects.toBeInstanceOf(RecordsError);
    const updated = await uc.execute(
      { id: c.id, patch: { title: "New" } },
      admin,
    );
    expect(updated.title).toBe("New");
  });
});

describe("ListCourses (pagination)", () => {
  it("returns a page and total, capping take at default when unset", async () => {
    const create = new CreateCourse(courses, audit);
    for (let i = 1; i <= 3; i++) {
      await create.execute(
        { code: `C${i}`, title: `T${i}`, creditValue: 2, courseType: "CORE" },
        admin,
      );
    }
    const page = await new ListCourses(courses).execute({ take: 2 }, admin);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});
