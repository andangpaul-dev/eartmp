/**
 * Diagnostics — a read-only support snapshot: app version, runtime health (host
 * reachable, database lock state), the signing-key seal state, and the audit
 * chain integrity. A one-click "Copy diagnostics" produces text to paste into a
 * support request. Permission-gated reads (key/audit) gracefully show "—" when
 * the operator can't see them, so the screen is safe for every signed-in user.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { Card, Button, Badge, Icon, type Tone } from "../components/ui";

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
    </div>
  );
}
