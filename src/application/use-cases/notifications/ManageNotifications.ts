/**
 * Notification use-cases. Any authenticated user may read + clear the worklist
 * for THEIR role (authenticatedOnly — no extra permission needed). Mark-read is
 * role-scoped in the repository so users can't touch another role's items.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import type {
  NotificationRepository,
  StoredNotification,
} from "../../../domain/repositories/notifications";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface ListNotificationsResult {
  items: StoredNotification[];
  unread: number;
}

export class ListNotifications implements AuthorizedUseCase<
  { unreadOnly?: boolean },
  ListNotificationsResult
> {
  readonly name = "ListNotifications";
  readonly requiredPermissions: string[] = [];
  readonly authenticatedOnly = true;

  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    input: { unreadOnly?: boolean },
    session: SessionContext,
  ): Promise<ListNotificationsResult> {
    const items = await this.notifications.listForRole(session.roleName, {
      unreadOnly: input?.unreadOnly,
      limit: 50,
    });
    const unread = await this.notifications.unreadCount(session.roleName);
    return { items, unread };
  }
}

export class MarkNotificationRead implements AuthorizedUseCase<
  { id: string },
  { ok: true }
> {
  readonly name = "MarkNotificationRead";
  readonly requiredPermissions: string[] = [];
  readonly authenticatedOnly = true;

  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    input: { id: string },
    session: SessionContext,
  ): Promise<{ ok: true }> {
    await this.notifications.markRead(input.id, session.roleName);
    return { ok: true };
  }
}

export class MarkAllNotificationsRead implements AuthorizedUseCase<
  Record<string, never>,
  { cleared: number }
> {
  readonly name = "MarkAllNotificationsRead";
  readonly requiredPermissions: string[] = [];
  readonly authenticatedOnly = true;

  constructor(private readonly notifications: NotificationRepository) {}

  async execute(
    _input: Record<string, never>,
    session: SessionContext,
  ): Promise<{ cleared: number }> {
    const cleared = await this.notifications.markAllRead(session.roleName);
    return { cleared };
  }
}
