/**
 * Users & roles — admin user management. List accounts, create a user, assign a
 * role, activate/deactivate, and reset a password. Every action is permission-
 * gated (the host re-checks) and audited. The acting admin can't deactivate
 * their own account.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import {
  Button,
  Card,
  Badge,
  Field,
  Modal,
  Toast,
  EmptyState,
  Icon,
  type Tone,
} from "../components/ui";
import type { UserSummary } from "../runtime/contract";

export function UsersScreen() {
  const core = useCore();
  const { session, can } = useSession();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<UserSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const users = useAsync(() => core.listUsers({}), []);
  const roles = useAsync(
    () => (can("roles.read") ? core.listRoles({}) : Promise.resolve([])),
    [],
  );

  const setActive = async (u: UserSummary, active: boolean) => {
    try {
      if (active) await core.activateUser({ userId: u.id });
      else await core.deactivateUser({ userId: u.id });
      users.reload();
      notify(`${u.username} ${active ? "activated" : "deactivated"}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  const changeRole = async (u: UserSummary, roleId: string) => {
    try {
      await core.assignRole({ userId: u.id, roleId });
      users.reload();
      notify(`${u.username}'s role updated`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="spread">
          <div className="muted">
            Signed in as <span className="mono">{session?.userId}</span> ·{" "}
            {session?.role}
          </div>
          {can("users.create") && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New user
            </Button>
          )}
        </div>
      </Card>

      <Card title="Users">
        {users.loading ? (
          <div className="muted" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : users.error ? (
          <div className="alert danger">{users.error.message}</div>
        ) : (users.data?.length ?? 0) === 0 ? (
          <EmptyState title="No users" />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.data!.map((u) => {
                const self = u.id === session?.userId;
                return (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td>
                    <td>{u.fullName}</td>
                    <td>
                      {can("roles.assign") && roles.data?.length ? (
                        <select
                          className="select"
                          aria-label={`Role for ${u.username}`}
                          value={u.roleId}
                          onChange={(e) => changeRole(u, e.target.value)}
                        >
                          {roles.data.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone="neutral">{u.roleName}</Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={u.isActive ? ("success" as Tone) : "danger"}>
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="mono muted">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>
                      <div
                        className="row"
                        style={{ justifyContent: "flex-end", gap: 6 }}
                      >
                        {can("users.update") && (
                          <Button
                            variant="ghost"
                            onClick={() => setResetFor(u)}
                          >
                            Reset password
                          </Button>
                        )}
                        {can("users.update") &&
                          (u.isActive ? (
                            <Button
                              variant="ghost"
                              disabled={self}
                              title={
                                self
                                  ? "You can't deactivate yourself"
                                  : undefined
                              }
                              onClick={() => setActive(u, false)}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => setActive(u, true)}
                            >
                              Activate
                            </Button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <CreateUserModal
          roles={roles.data ?? []}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            users.reload();
            notify("User created");
          }}
        />
      )}

      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => {
            setResetFor(null);
            notify("Password reset");
          }}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function CreateUserModal({
  roles,
  onClose,
  onDone,
}: {
  roles: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [password, setPassword] = useState("");

  const save = useAction(
    () => core.createUser({ username, fullName, email, roleId, password }),
    { onSuccess: onDone },
  );
  const complete = username && fullName && email && roleId && password;
  const fieldErr = save.error?.fields;

  return (
    <Modal
      title="New user"
      subtitle="The password is hashed (Argon2id); it's never stored in plaintext."
      onClose={onClose}
    >
      <Field label="Username" error={fieldErr?.username}>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Full name">
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field label="Email">
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Role" error={fieldErr?.roleId}>
        <select
          className="select"
          aria-label="Role"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Temporary password (min 8 chars)"
        error={fieldErr?.password}
      >
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {save.error && !fieldErr && (
        <div className="alert danger">{save.error.message}</div>
      )}
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!complete}
          loading={save.loading}
          onClick={save.run}
        >
          Create user
        </Button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [newPassword, setNewPassword] = useState("");
  const save = useAction(
    () => core.resetUserPassword({ userId: user.id, newPassword }),
    { onSuccess: onDone },
  );
  return (
    <Modal
      title={`Reset password · ${user.username}`}
      subtitle="Sets a new password (Argon2id). Share it securely; the user should change it."
      onClose={onClose}
    >
      <Field
        label="New password (min 8 chars)"
        error={save.error?.fields?.newPassword}
      >
        <input
          className="input"
          type="password"
          autoFocus
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Field>
      {save.error && !save.error.fields && (
        <div className="alert danger">{save.error.message}</div>
      )}
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={newPassword.length < 8}
          loading={save.loading}
          onClick={save.run}
        >
          Reset password
        </Button>
      </div>
    </Modal>
  );
}
