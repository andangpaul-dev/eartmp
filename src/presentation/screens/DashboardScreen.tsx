/**
 * Dashboard — registry at-a-glance. Makes a real call through the host
 * (`listStudents`) to prove the webview→host→core→SQLite path end to end, and
 * shows the four async states via `useAsync`.
 */
import { useCore, useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { useAsync } from "../runtime/hooks";
import { Card, Badge } from "../components/ui";

export function DashboardScreen() {
  const core = useCore();
  const { session, can } = useSession();
  const { sealed } = useKeyState();
  const students = useAsync(() => core.listStudents({ take: 1 }), []);
  const chain = useAsync(
    () =>
      can("audit.read") ? core.verifyAuditChain({}) : Promise.resolve(null),
    [],
  );

  return (
    <div className="stack">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 14,
        }}
      >
        <Card title="Students">
          <Stat
            loading={students.loading}
            error={!!students.error}
            value={students.data?.total ?? 0}
          />
        </Card>
        <Card title="Signing key">
          {sealed ? (
            <Badge tone="warn">Sealed</Badge>
          ) : (
            <Badge tone="success">Unsealed</Badge>
          )}
        </Card>
        <Card title="Audit integrity">
          {chain.loading ? (
            <span className="muted">Checking…</span>
          ) : !can("audit.read") ? (
            <Badge tone="neutral">Not authorized</Badge>
          ) : chain.error || !chain.data ? (
            <Badge tone="neutral">Unknown</Badge>
          ) : chain.data.valid ? (
            <Badge tone="success">Verified · {chain.data.checked}</Badge>
          ) : (
            <Badge tone="danger">Broken</Badge>
          )}
        </Card>
        <Card title="Session">
          <div className="mono" style={{ fontSize: 13 }}>
            {session?.role}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {session?.permissions.length} permissions
          </div>
        </Card>
      </div>

      <Card title="Welcome">
        <div className="muted" style={{ lineHeight: 1.6 }}>
          This is the EARTMP desktop shell talking to the finished core through
          the Node host. Use the sidebar to navigate — items your role can't
          access are locked. The numbers above are live from SQLite through the
          authorization gate.
        </div>
      </Card>
    </div>
  );
}

function Stat({
  loading,
  error,
  value,
}: {
  loading: boolean;
  error: boolean;
  value: number;
}) {
  if (loading) return <div className="muted">Loading…</div>;
  if (error)
    return <div style={{ color: "var(--danger-fg)" }}>Unavailable</div>;
  return (
    <div
      className="mono"
      style={{ fontSize: 32, fontWeight: 600, color: "var(--text-strong)" }}
    >
      {value}
    </div>
  );
}
