/**
 * DatabaseLockedHelp — shown when a SQLITE_BUSY / "database is locked" error
 * is detected. Guides the operator through the standard recovery sequence
 * without leaving the app.
 */
import { Button } from "./ui";

export function isDatabaseLockedError(message: string | undefined): boolean {
  if (!message) return false;
  // Match ONLY the DB-lock condition — not a generic "X is locked" message
  // (e.g. a future "account is locked"), which must show its own error.
  return /database is locked|SQLITE_BUSY/i.test(message);
}

export function DatabaseLockedHelp({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="alert"
      aria-label="Database is locked help"
      className="alert warn"
      style={{ marginBottom: 14 }}
    >
      <strong>Database is locked</strong>
      <ol style={{ margin: "8px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
        <li>Close all EARTMP windows, then reopen the app.</li>
        <li>
          If the error persists, open Task Manager and end any{" "}
          <code>eartmp</code> or <code>eartmp-node</code> processes.
        </li>
        <li>If the database is still locked, restart your computer.</li>
      </ol>
      {onRetry && (
        <div style={{ marginTop: 10 }}>
          <Button variant="default" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
