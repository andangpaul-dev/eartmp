/**
 * Notification repository (workflow handoffs). A notification is addressed to a
 * ROLE — every user holding that role shares the worklist — so when one stage of
 * the academic workflow completes, the next role is told to take over.
 */
export interface StoredNotification {
  id: string;
  recipientRole: string;
  actorUserId?: string | null;
  title: string;
  body?: string | null;
  level: string; // INFO | WARNING | ERROR
  isRead: boolean;
  createdAt: string;
}

export interface NewNotification {
  recipientRole: string;
  title: string;
  body?: string;
  actorUserId?: string;
  level?: string;
}

export interface NotificationRepository {
  create(data: NewNotification): Promise<StoredNotification>;
  /** Most-recent-first; `unreadOnly` filters to outstanding handoffs. */
  listForRole(
    role: string,
    opts?: { unreadOnly?: boolean; limit?: number },
  ): Promise<StoredNotification[]>;
  unreadCount(role: string): Promise<number>;
  /** Role-scoped so a user can only clear their own role's items. */
  markRead(id: string, role: string): Promise<void>;
  markAllRead(role: string): Promise<number>;
}
