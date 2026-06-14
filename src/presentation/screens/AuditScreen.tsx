/**
 * Audit log — the append-only, tamper-evident trail. Filter by entity/action,
 * page through entries, and run a chain verification that recomputes every
 * hash link and reports the first broken one. Read-only; the chain result is
 * surfaced prominently because it is the integrity guarantee.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { Button, Card, Badge, Field, EmptyState, Icon } from "../components/ui";
import type { ChainVerification } from "../runtime/contract";

const PAGE = 25;

export function AuditScreen() {
  const core = useCore();
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [chain, setChain] = useState<ChainVerification | null>(null);

  const log = useAsync(
    () =>
      core.getAuditLog({
        entity: entity || undefined,
        action: action || undefined,
        skip: page * PAGE,
        take: PAGE,
      }),
    [entity, action, page],
  );

  const verify = useAction(() => core.verifyAuditChain({}), {
    onSuccess: setChain,
  });

  const total = log.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="stack">
      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <Field label="Entity">
              <input
                className="input"
                aria-label="Filter by entity"
                placeholder="e.g. Transcript"
                value={entity}
                onChange={(e) => {
                  setPage(0);
                  setEntity(e.target.value);
                }}
              />
            </Field>
            <Field label="Action">
              <input
                className="input"
                aria-label="Filter by action"
                placeholder="e.g. EXPORT"
                value={action}
                onChange={(e) => {
                  setPage(0);
                  setAction(e.target.value);
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            loading={verify.loading}
            onClick={verify.run}
          >
            <Icon name="shield" size={15} /> Verify chain
          </Button>
        </div>

        {chain && (
          <div
            className={`chain-banner ${chain.valid ? "ok" : "bad"}`}
            style={{ marginTop: 14 }}
          >
            <Icon name={chain.valid ? "check" : "shield"} size={18} />
            {chain.valid ? (
              <span>
                Chain intact — {chain.checked} linked entries verified.
              </span>
            ) : (
              <span>
                Chain BROKEN at entry #{chain.brokenAt?.index ?? "?"} (id{" "}
                <span className="mono">{chain.brokenAt?.id ?? "?"}</span>) after{" "}
                {chain.checked} valid links.
              </span>
            )}
          </div>
        )}
      </Card>

      <Card>
        {log.loading ? (
          <div className="muted" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : log.error ? (
          <div className="alert danger">{log.error.message}</div>
        ) : (log.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No audit entries"
            hint="Nothing matches these filters."
          />
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Record</th>
                  <th>Chained</th>
                </tr>
              </thead>
              <tbody>
                {log.data!.items.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="mono">{e.userId ?? "—"}</td>
                    <td>
                      <Badge tone="neutral">{e.action}</Badge>
                    </td>
                    <td>{e.entity}</td>
                    <td className="mono">{e.recordId?.slice(0, 8) ?? "—"}</td>
                    <td>
                      {e.hash ? (
                        <span className="verify-ok" title={e.hash}>
                          <Icon name="check" size={13} /> linked
                        </span>
                      ) : (
                        <span className="muted">pre-chain</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="spread" style={{ marginTop: 12 }}>
              <span className="muted">
                {total} entries · page {page + 1} of {pages}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <Button
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
