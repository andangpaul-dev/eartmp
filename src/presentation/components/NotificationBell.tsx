/**
 * NotificationBell — the topbar worklist for "you're next in line" handoffs. A
 * bell with an unread count opens a dropdown of recent notifications (mark one /
 * mark all read). A freshly-arrived handoff flashes a toast for ~5s so the next
 * user notices it the moment the previous stage completes.
 */
import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../runtime/useNotifications";
import { Icon, Toast } from "./ui";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  // Flash a toast when a NEW unread handoff arrives (not on the first load).
  useEffect(() => {
    const fresh = items.filter((i) => !i.isRead && !seen.current.has(i.id));
    items.forEach((i) => seen.current.add(i.id));
    if (primed.current && fresh.length) {
      setFlash(fresh[0]!.title);
      const t = setTimeout(() => setFlash(null), 5000);
      return () => clearTimeout(t);
    }
    primed.current = true;
    return undefined;
  }, [items]);

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="btn ghost bell-btn"
        title="Notifications"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell-badge">{unread}</span>}
      </button>

      {open && (
        <>
          <div className="bell-scrim" onClick={() => setOpen(false)} />
          <div className="bell-menu" role="menu">
            <div className="bell-head">
              <span>Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  className="linklike"
                  onClick={() => markAllRead()}
                >
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="bell-empty">You're all caught up.</div>
            ) : (
              <ul className="bell-list">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={`bell-item ${n.isRead ? "" : "unread"}`}
                  >
                    <div className="bell-title">{n.title}</div>
                    <div className="bell-meta">
                      <span>{timeAgo(n.createdAt)}</span>
                      {!n.isRead && (
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => markRead(n.id)}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {flash && <Toast message={flash} />}
    </div>
  );
}
