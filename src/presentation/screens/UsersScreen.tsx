/**
 * Users & roles — the core ships RBAC (seeded roles + permissions) and the
 * write use-cases (create user, assign role, deactivate), but no read endpoint
 * to LIST users or roles. A management table needs `ListUsers`/`ListRoles`
 * use-cases on the core; those are core additions outside this shell's scope, so
 * this screen states the situation honestly rather than stubbing a half-feature.
 * Your own credentials are managed under Configuration → Security.
 */
import { useSession } from "../runtime/CoreProvider";
import { Card, Badge, EmptyState } from "../components/ui";

export function UsersScreen() {
  const { session } = useSession();
  return (
    <div className="stack">
      <Card title="Your access">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Badge tone="info">{session?.role}</Badge>
          <Badge tone="neutral">
            {session?.permissions.length} permissions
          </Badge>
        </div>
        <div className="muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Change your own password under Configuration → Security.
        </div>
      </Card>

      <Card title="User management">
        <EmptyState
          title="Management table not available yet"
          hint="The core enforces RBAC and supports create / assign-role / deactivate, but exposes no endpoint to list users or roles. A read endpoint (ListUsers / ListRoles) is needed before this screen can render a management table — a core addition, intentionally not stubbed here."
        />
      </Card>
    </div>
  );
}
