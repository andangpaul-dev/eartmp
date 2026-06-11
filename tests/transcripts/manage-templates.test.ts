import { describe, it, expect, beforeEach } from "vitest";
import {
  CreateTemplate,
  UpdateTemplate,
  CloneTemplate,
  SetDefaultTemplate,
  DeleteTemplate,
  ListTemplates,
} from "../../src/application/use-cases/transcripts/ManageTemplates";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import { TranscriptError } from "../../src/domain/errors/transcript";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import { CapturingAudit } from "../auth/fakes";
import type {
  TranscriptTemplateStore,
  StoredTemplate,
  NewTemplate,
} from "../../src/domain/repositories/transcripts";

const admin = SessionContext.create("admin", "SUPER_ADMIN", [
  "templates.read",
  "templates.manage",
]);

const validLayout = {
  blocks: [
    { type: "title", value: "T" },
    {
      type: "fieldGrid",
      fields: [{ label: "Name", bind: "student.fullName" }],
    },
  ],
};
const invalidLayout = {
  blocks: [
    { type: "fieldGrid", fields: [{ label: "X", bind: "student.nope" }] },
  ],
};

class FakeTemplateStore implements TranscriptTemplateStore {
  rows: StoredTemplate[] = [];
  inUse = new Set<string>();
  private seq = 0;
  async findDefault() {
    return this.rows.find((r) => r.isDefault) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list() {
    return [...this.rows];
  }
  async findByName(name: string) {
    return this.rows.find((r) => r.name === name) ?? null;
  }
  async create(data: NewTemplate) {
    const t: StoredTemplate = {
      id: `tpl${++this.seq}`,
      name: data.name,
      version: 1,
      layout: data.layout,
      isDefault: data.isDefault,
    };
    this.rows.push(t);
    return { ...t };
  }
  async update(
    id: string,
    data: { name?: string; layout?: string; version: number },
  ) {
    const t = this.rows.find((r) => r.id === id)!;
    if (data.name !== undefined) t.name = data.name;
    if (data.layout !== undefined) t.layout = data.layout;
    t.version = data.version;
    return { ...t };
  }
  async softDelete(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async setDefault(id: string) {
    for (const r of this.rows) r.isDefault = r.id === id;
  }
  async countTranscriptsUsing(id: string) {
    return this.inUse.has(id) ? 1 : 0;
  }
}

let store: FakeTemplateStore;
let audit: CapturingAudit;
beforeEach(() => {
  store = new FakeTemplateStore();
  audit = new CapturingAudit();
});

describe("CreateTemplate", () => {
  it("creates a valid template and audits", async () => {
    const t = await new CreateTemplate(store, audit).execute(
      { name: "Official", layout: validLayout },
      admin,
    );
    expect(t.version).toBe(1);
    expect(audit.entries[0]).toMatchObject({
      action: "CREATE",
      entity: "TranscriptTemplate",
    });
  });

  it("rejects an invalid layout on save", async () => {
    await expect(
      new CreateTemplate(store, audit).execute(
        { name: "Bad", layout: invalidLayout },
        admin,
      ),
    ).rejects.toBeInstanceOf(TranscriptError);
    expect(store.rows).toHaveLength(0);
  });

  it("rejects a duplicate name", async () => {
    const uc = new CreateTemplate(store, audit);
    await uc.execute({ name: "Official", layout: validLayout }, admin);
    await expect(
      uc.execute({ name: "Official", layout: validLayout }, admin),
    ).rejects.toThrow(/already exists/);
  });

  it("is denied without templates.manage", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["templates.read"]);
    await expect(
      authorize(
        new CreateTemplate(store, audit),
        { name: "X", layout: validLayout },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("UpdateTemplate (version bump)", () => {
  it("bumps the version and re-validates", async () => {
    const created = await new CreateTemplate(store, audit).execute(
      { name: "Official", layout: validLayout },
      admin,
    );
    const uc = new UpdateTemplate(store, audit);
    const v2 = await uc.execute({ id: created.id, name: "Renamed" }, admin);
    expect(v2.version).toBe(2);
    expect(v2.name).toBe("Renamed");
    await expect(
      uc.execute({ id: created.id, layout: invalidLayout }, admin),
    ).rejects.toBeInstanceOf(TranscriptError);
  });
});

describe("Clone / SetDefault / Delete", () => {
  it("clones (copies layout, not default)", async () => {
    const created = await new CreateTemplate(store, audit).execute(
      { name: "Official", layout: validLayout },
      admin,
    );
    const clone = await new CloneTemplate(store, audit).execute(
      { id: created.id, name: "Copy" },
      admin,
    );
    expect(clone.isDefault).toBe(false);
    expect(clone.layout).toBe(created.layout);
  });

  it("keeps a single default and guards delete of the default + in-use", async () => {
    const create = new CreateTemplate(store, audit);
    const a = await create.execute({ name: "A", layout: validLayout }, admin);
    const b = await create.execute({ name: "B", layout: validLayout }, admin);
    await new SetDefaultTemplate(store, audit).execute({ id: a.id }, admin);
    await new SetDefaultTemplate(store, audit).execute({ id: b.id }, admin);
    expect((await store.findDefault())?.name).toBe("B");

    await expect(
      new DeleteTemplate(store, audit).execute({ id: b.id }, admin),
    ).rejects.toThrow(/default/);

    store.inUse.add(a.id);
    await expect(
      new DeleteTemplate(store, audit).execute({ id: a.id }, admin),
    ).rejects.toThrow(/issued transcripts/);

    store.inUse.delete(a.id);
    await new DeleteTemplate(store, audit).execute({ id: a.id }, admin);
    expect(
      (await new ListTemplates(store).execute({}, admin)).map((t) => t.name),
    ).toEqual(["B"]);
  });
});
