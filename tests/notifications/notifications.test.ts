import { describe, it, expect, beforeEach } from "vitest";
import {
  ListNotifications,
  MarkNotificationRead,
  MarkAllNotificationsRead,
} from "../../src/application/use-cases/notifications/ManageNotifications";
import { WorkflowNotifier } from "../../src/application/services/WorkflowNotifier";
import { SessionContext } from "../../src/domain/value-objects/SessionContext";
import type {
  NotificationRepository,
  NewNotification,
  StoredNotification,
} from "../../src/domain/repositories/notifications";

class FakeRepo implements NotificationRepository {
  rows: StoredNotification[] = [];
  private seq = 0;
  async create(d: NewNotification) {
    const r: StoredNotification = {
      id: `n${++this.seq}`,
      recipientRole: d.recipientRole,
      actorUserId: d.actorUserId ?? null,
      title: d.title,
      body: d.body ?? null,
      level: d.level ?? "INFO",
      isRead: false,
      createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    };
    this.rows.push(r);
    return r;
  }
  async listForRole(role: string, opts?: { unreadOnly?: boolean }) {
    return this.rows.filter(
      (r) => r.recipientRole === role && (!opts?.unreadOnly || !r.isRead),
    );
  }
  async unreadCount(role: string) {
    return this.rows.filter((r) => r.recipientRole === role && !r.isRead)
      .length;
  }
  async markRead(id: string, role: string) {
    const r = this.rows.find((x) => x.id === id && x.recipientRole === role);
    if (r) r.isRead = true;
  }
  async markAllRead(role: string) {
    let n = 0;
    for (const r of this.rows)
      if (r.recipientRole === role && !r.isRead) {
        r.isRead = true;
        n++;
      }
    return n;
  }
}

const registrar = SessionContext.create("reg", "REGISTRAR", []);
const dataentry = SessionContext.create("dee", "DATA_ENTRY", []);

let repo: FakeRepo;
beforeEach(() => {
  repo = new FakeRepo();
});

describe("WorkflowNotifier (next role in line)", () => {
  it("notifies the next role when a mapped task completes", async () => {
    const notifier = new WorkflowNotifier(repo);
    await notifier.afterTask("enterResult", "dee");
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      recipientRole: "REGISTRAR",
      actorUserId: "dee",
    });
    expect(repo.rows[0]!.title).toMatch(/ready to process/i);
  });

  it("emits nothing for an unmapped method", async () => {
    await new WorkflowNotifier(repo).afterTask("listStudents", "dee");
    expect(repo.rows).toHaveLength(0);
  });
});

describe("Notification use-cases", () => {
  it("lists a role's worklist with the unread count", async () => {
    await new WorkflowNotifier(repo).afterTask("enterResult", "dee");
    const out = await new ListNotifications(repo).execute({}, registrar);
    expect(out.unread).toBe(1);
    expect(out.items).toHaveLength(1);
    // A different role sees nothing.
    expect(
      (await new ListNotifications(repo).execute({}, dataentry)).items,
    ).toHaveLength(0);
  });

  it("marks read only within the caller's own role", async () => {
    await new WorkflowNotifier(repo).afterTask("enterResult", "dee");
    const id = repo.rows[0]!.id;
    // Wrong role → no-op (role-scoped).
    await new MarkNotificationRead(repo).execute({ id }, dataentry);
    expect(repo.rows[0]!.isRead).toBe(false);
    // Correct role → marked.
    await new MarkNotificationRead(repo).execute({ id }, registrar);
    expect(repo.rows[0]!.isRead).toBe(true);
  });

  it("marks all of a role's notifications read", async () => {
    const n = new WorkflowNotifier(repo);
    await n.afterTask("enterResult", "dee");
    await n.afterTask("generateTranscript", "reg");
    const out = await new MarkAllNotificationsRead(repo).execute({}, registrar);
    expect(out.cleared).toBe(2);
    expect(await repo.unreadCount("REGISTRAR")).toBe(0);
  });
});
