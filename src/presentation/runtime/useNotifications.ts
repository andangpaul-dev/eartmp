/**
 * useNotifications — polls the current role's workflow worklist (handoffs from
 * the previous stage) and exposes it for the topbar bell + flash toast. Polling
 * is light (every 30s) and best-effort; it also reloads on demand after actions.
 */
import { useCallback, useEffect, useState } from "react";
import { useCore } from "./CoreProvider";
import type { StoredNotification } from "./contract";

const POLL_MS = 30_000;

export interface NotificationsState {
  items: StoredNotification[];
  unread: number;
  reload: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export function useNotifications(): NotificationsState {
  const core = useCore();
  const [items, setItems] = useState<StoredNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const reload = useCallback(() => {
    core
      .listNotifications({})
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => {
        /* notifications are non-critical; ignore transient failures */
      });
  }, [core]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const markRead = useCallback(
    async (id: string) => {
      await core.markNotificationRead({ id });
      reload();
    },
    [core, reload],
  );
  const markAllRead = useCallback(async () => {
    await core.markAllNotificationsRead({});
    reload();
  }, [core, reload]);

  return { items, unread, reload, markRead, markAllRead };
}
