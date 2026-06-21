/**
 * Diagnostics — a read-only support snapshot: app version, runtime health (host
 * reachable, database lock state), the signing-key seal state, and the audit
 * chain integrity. A one-click "Copy diagnostics" produces text to paste into a
 * support request. Permission-gated reads (key/audit) gracefully show "—" when
 * the operator can't see them, so the screen is safe for every signed-in user.
 */
import { useRef, useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { Card, Button, Badge, Icon, type Tone } from "../components/ui";
import { DatabaseLockedHelp } from "../components/DatabaseLockedHelp";

/** Minimal shape of the updater's Update object we use (avoids importing the
 *  plugin's types into a screen that also renders in the browser/tests). */
interface PendingUpdate {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

function UpdatesCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<PendingUpdate | null>(null);
  const held = useRef<PendingUpdate | null>(null);
  // The updater is a Tauri shell feature — only meaningful inside the desktop app.
  const inApp =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const check = async (): Promise<void> => {
    setBusy(true);
    setStatus("");
    setPending(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = (await check()) as PendingUpdate | null;
      held.current = update;
      if (update) {
        setPending(update);
        setStatus(`Update ${update.version} is available.`);
      } else {
        setStatus("You are on the latest version.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Update check failed.");
    } finally {
      setBusy(false);
    }
  };

  const install = async (): Promise<void> => {
    if (!held.current) return;
    setBusy(true);
    setStatus(`Downloading ${held.current.version}…`);
    try {
      await held.current.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Update install failed.");
      setBusy(false);
    }
  };

  return (
    <Card title="Software updates">
      {!inApp ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Updates are managed by the installed desktop app.
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <Button onClick={check} loading={busy && !pending}>
              <Icon name="download" size={14} /> Check for updates
            </Button>
            {pending && (
              <Button variant="primary" loading={busy} onClick={install}>
                Download &amp; install {pending.version}
              </Button>
            )}
          </div>
          {status && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
              {status}
            </div>
          )}
          {pending?.body && (
            <pre className="errdetail" style={{ maxHeight: 120, marginTop: 8 }}>
              {pending.body}
            </pre>
          )}
        </>
      )}
    </Card>
  );
}

type Row = { label: string; value: string; tone: Tone };

export function DiagnosticsScreen() {
  const core = useCore();
  const { can } = useSession();

  const lock = useAsync(() => core.lockState(), []);
  const key = useAsync(
    () =>
      can("transcripts.read")
        ? core.keyState({})
        : Promise.resolve(null as { sealed: boolean } | null),
    [],
  );
  const audit = useAsync(
    () =>
      can("audit.read") ? core.verifyAuditChain({}) : Promise.resolve(null),
    [],
  );
  const [copied, setCopied] = useState(false);

  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?";
  const dbValue = lock.error
    ? "Host unreachable"
    : lock.data
      ? `${lock.data.locked ? "Locked" : "Open"}${lock.data.required ? " · encrypted" : ""}`
      : "…";
  const keyValue = !can("transcripts.read")
    ? "—"
    : key.data
      ? key.data.sealed
        ? "Sealed"
        : "Unsealed this session"
      : "…";
  const auditValue = !can("audit.read")
    ? "—"
    : audit.data
      ? audit.data.valid
        ? `Intact (${audit.data.checked}/${audit.data.total})`
        : `BROKEN at entry ${audit.data.brokenAt?.index ?? "?"}`
      : "…";

  const rows: Row[] = [
    { label: "App version", value: version, tone: "neutral" },
    {
      label: "Platform",
      value: navigator.platform || "unknown",
      tone: "neutral",
    },
    {
      label: "Database",
      value: dbValue,
      tone: lock.error ? "danger" : "info",
    },
    {
      label: "Signing key",
      value: keyValue,
      tone: key.data?.sealed ? "warn" : "info",
    },
    {
      label: "Audit chain",
      value: auditValue,
      tone:
        audit.data && !audit.data.valid
          ? "danger"
          : audit.data
            ? "success"
            : "neutral",
    },
  ];

  const diagnosticsText = (): string =>
    [
      `EARTMP diagnostics`,
      `Generated: ${new Date().toISOString()}`,
      `App version: ${version}`,
      `Platform: ${navigator.platform || "unknown"}`,
      `User agent: ${navigator.userAgent}`,
      `Database: ${dbValue}`,
      `Signing key: ${keyValue}`,
      `Audit chain: ${auditValue}`,
    ].join("\n");

  const copy = (): void => {
    void navigator.clipboard?.writeText(diagnosticsText()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="stack">
      <Card title="Diagnostics">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          A read-only snapshot of the app and its data integrity — handy to
          paste into a support request.
        </div>
        <table className="data">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ width: 160 }}>{r.label}</td>
                <td>
                  <Badge tone={r.tone}>{r.value}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <Button variant="primary" onClick={copy}>
            <Icon name={copied ? "check" : "download"} size={14} />{" "}
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
        </div>
      </Card>

      <Card title="Troubleshooting">
        <DatabaseLockedHelp />
      </Card>

      <UpdatesCard />
    </div>
  );
}
