import { describe, it, expect } from "vitest";
import {
  GetAuditLog,
  VerifyAuditChain,
} from "../../src/application/use-cases/audit/AuditQueries";
import { authorize } from "../../src/application/authorization/AuthorizedUseCase";
import {
  canonicalAuditPayload,
  type AuditEntry,
} from "../../src/domain/services/AuditChain";
import { AuthorizationError } from "../../src/domain/errors/auth";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  AuditLogQueryRepository,
  AuditQuery,
} from "../../src/domain/repositories/audit";
import type { Page } from "../../src/domain/repositories/records";
import type { AuditHasher } from "../../src/application/ports/AuditHasher";

const admin = SessionContext.create("a", "ADMIN", ["audit.read"]);
const hasher: AuditHasher = { hash: (d) => `h:${d}` };

function chained(actions: string[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  let prev = "";
  actions.forEach((action, i) => {
    const e: AuditEntry = {
      id: String(i + 1),
      userId: "u1",
      action,
      entity: "E",
      createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      prevHash: prev || undefined,
    };
    e.hash = hasher.hash(prev + canonicalAuditPayload(e));
    out.push(e);
    prev = e.hash;
  });
  return out;
}

class FakeRepo implements AuditLogQueryRepository {
  constructor(public rows: AuditEntry[]) {}
  async find(q: AuditQuery): Promise<Page<AuditEntry>> {
    let r = this.rows.filter(
      (e) =>
        (!q.actorId || e.userId === q.actorId) &&
        (!q.entity || e.entity === q.entity) &&
        (!q.action || e.action === q.action),
    );
    const total = r.length;
    r = r.slice(q.skip ?? 0, (q.skip ?? 0) + (q.take ?? 50));
    return { items: r, total };
  }
  async listOrdered() {
    return this.rows;
  }
}

describe("GetAuditLog", () => {
  it("filters and paginates", async () => {
    const repo = new FakeRepo(chained(["CREATE", "UPDATE", "EXPORT"]));
    const r = await new GetAuditLog(repo).execute({ action: "UPDATE" }, admin);
    expect(r.total).toBe(1);
    expect(r.items[0]!.action).toBe("UPDATE");
  });

  it("caps take at 200", async () => {
    let captured = 0;
    const repo: AuditLogQueryRepository = {
      async find(q) {
        captured = q.take ?? 0;
        return { items: [], total: 0 };
      },
      async listOrdered() {
        return [];
      },
    };
    await new GetAuditLog(repo).execute({ take: 9999 }, admin);
    expect(captured).toBe(200);
  });

  it("requires audit.read", async () => {
    const viewer = SessionContext.create("v", "VIEWER", ["students.read"]);
    await expect(
      authorize(new GetAuditLog(new FakeRepo([])), {}, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("VerifyAuditChain", () => {
  it("verifies a clean chain", async () => {
    const repo = new FakeRepo(chained(["CREATE", "UPDATE"]));
    const r = await new VerifyAuditChain(repo, hasher).execute({}, admin);
    expect(r).toMatchObject({ valid: true, checked: 2 });
  });

  it("detects a tampered entry", async () => {
    const rows = chained(["CREATE", "UPDATE", "EXPORT"]);
    rows[1]!.newValue = '{"tampered":1}';
    const r = await new VerifyAuditChain(new FakeRepo(rows), hasher).execute(
      {},
      admin,
    );
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toMatchObject({ index: 1, reason: "content" });
  });
});
