/**
 * Prisma-backed NotificationRepository. Notifications are role-addressed; reads
 * and mark-read are scoped to a role so users only touch their own worklist.
 */
import type { PrismaClient } from "@prisma/client";
import type {
  NotificationRepository,
  NewNotification,
  StoredNotification,
} from "../../domain/repositories/notifications";

type Row = {
  id: string;
  recipientRole: string;
  actorUserId: string | null;
  title: string;
  body: string | null;
  level: string;
  isRead: boolean;
  createdAt: Date;
};

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaClient) {}

  private map(r: Row): StoredNotification {
    return {
      id: r.id,
      recipientRole: r.recipientRole,
      actorUserId: r.actorUserId,
      title: r.title,
      body: r.body,
      level: r.level,
      isRead: r.isRead,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async create(data: NewNotification): Promise<StoredNotification> {
    const r = await this.db.notification.create({
      data: {
        recipientRole: data.recipientRole,
        title: data.title,
        body: data.body ?? null,
        actorUserId: data.actorUserId ?? null,
        level: data.level ?? "INFO",
      },
    });
    return this.map(r as Row);
  }

  async listForRole(
    role: string,
    opts?: { unreadOnly?: boolean; limit?: number },
  ): Promise<StoredNotification[]> {
    const rows = await this.db.notification.findMany({
      where: {
        recipientRole: role,
        deletedAt: null,
        ...(opts?.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 50,
    });
    return rows.map((r) => this.map(r as Row));
  }

  async unreadCount(role: string): Promise<number> {
    return this.db.notification.count({
      where: { recipientRole: role, isRead: false, deletedAt: null },
    });
  }

  async markRead(id: string, role: string): Promise<void> {
    await this.db.notification.updateMany({
      where: { id, recipientRole: role },
      data: { isRead: true },
    });
  }

  async markAllRead(role: string): Promise<number> {
    const r = await this.db.notification.updateMany({
      where: { recipientRole: role, isRead: false },
      data: { isRead: true },
    });
    return r.count;
  }
}
