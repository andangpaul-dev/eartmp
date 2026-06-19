/**
 * Shared UI primitives (webview): Button, Field, Badge, Card, EmptyState,
 * Modal, Toast, and a small line-icon set. Pure presentation — no core imports.
 */
import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconName =
  | "dashboard"
  | "students"
  | "results"
  | "transcript"
  | "graduation"
  | "config"
  | "audit"
  | "admin"
  | "search"
  | "lock"
  | "key"
  | "logout"
  | "shield"
  | "chevron"
  | "plus"
  | "check"
  | "download"
  | "bell";

const PATHS: Record<IconName, string> = {
  dashboard: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  students:
    "M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.7 0-6 1.3-6 4v2h7m9-6c-2.7 0-7 1.3-7 4v2h11v-2c0-2.7-1.3-4-4-4Z",
  results: "M4 4h16v4H4zM4 10h16v4H4zM4 16h10v4H4z",
  transcript: "M6 2h9l5 5v15H6zM14 2v6h6",
  graduation: "M2 8l10-5 10 5-10 5zM6 11v5c0 1 3 3 6 3s6-2 6-3v-5",
  config:
    "M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4Zm8 4a8 8 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1l-.4-2.6H9.6L9.2 5a8 8 0 0 0-1.7 1L5 5 3 8.4 5 10a8 8 0 0 0 0 2l-2 1.6L5 17l2.5-1a8 8 0 0 0 1.7 1l.4 2.6h4.8l.4-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a8 8 0 0 0 .1-1Z",
  audit: "M9 11l2 2 4-4M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z",
  admin: "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z",
  search: "M11 19a8 8 0 1 1 5.3-2L21 21",
  lock: "M6 10V8a6 6 0 0 1 12 0v2M5 10h14v11H5z",
  key: "M14 7a4 4 0 1 0-3.9 5L4 18v3h3l1-1h2v-2h2l1.9-1.9A4 4 0 0 0 14 7Z",
  logout: "M16 17l5-5-5-5M21 12H9M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7",
  shield: "M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z",
  chevron: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  check: "M5 13l4 4L19 7",
  download: "M12 3v12m0 0l-4-4m4 4l4-4M5 21h14",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Button({
  children,
  variant = "default",
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  loading?: boolean;
}) {
  return (
    <button
      className={`btn ${variant}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <span className="spin" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <div className="err">{error}</div>}
    </label>
  );
}

export function Card({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  );
}

export type Tone = "success" | "info" | "warn" | "danger" | "neutral";
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="bdot" />
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock background scroll

    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));

    // Move focus into the dialog.
    (focusables()[0] ?? ref.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.(); // restore focus to the trigger
    };
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {/* Scrollable body so tall dialogs get an up/down scrollbar; any
            trailing `.actions` row sticks to the bottom (see styles.css). */}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return <div className="toast">{message}</div>;
}
