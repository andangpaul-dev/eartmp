/**
 * Roles & permissions — create custom roles, rename/delete them, and edit each
 * role's permission set from the full catalogue. Gated roles.assign (writes) /
 * roles.read (catalogue). A role with users assigned can't be deleted.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useDialogs } from "../runtime/DialogProvider";
import { useAsync } from "../runtime/hooks";
import {
  Card,
  Button,
  Field,
  Modal,
  Toast,
  Badge,
  Icon,
} from "../components/ui";
import type { Role, Permission } from "../runtime/contract";

export function RolesScreen() {
  const core = useCore();
  const { can } = useSession();
  const { confirm, prompt } = useDialogs();
  const manage = can("roles.assign");
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Action failed");
    }
  };

  const roles = useAsync(() => core.listRoles({}), []);
  const permissions = useAsync(() => core.listPermissions({}), []);

  return (
    <div className="stack">
      <Card title="Roles">
        <div className="spread" style={{ marginBottom: 12 }}>
          <span className="muted">
            Roles bundle permissions; users are assigned a single role.
          </span>
          {manage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New role
            </Button>
          )}
        </div>
        {roles.loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permissions</th>
                {manage && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {roles.data?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.description && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge tone="neutral">{r.permissions.length}</Badge>
                  </td>
                  {manage && (
                    <td style={{ textAlign: "right" }}>
                      <div
                        className="row"
                        style={{ justifyContent: "flex-end", gap: 6 }}
                      >
                        <Button variant="ghost" onClick={() => setEditing(r)}>
                          Permissions
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            const n = await prompt({
                              title: `Rename "${r.name}"`,
                              fieldLabel: "Role name",
                              defaultValue: r.name,
                              confirmLabel: "Rename",
                            });
                            if (n && n.trim())
                              guard(async () => {
                                await core.updateRole({
                                  id: r.id,
                                  patch: { name: n.trim() },
                                });
                                roles.reload();
                              }, "Renamed");
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `Delete role "${r.name}"?`,
                                danger: true,
                                confirmLabel: "Delete",
                              })
                            )
                              guard(async () => {
                                await core.deleteRole({ id: r.id });
                                roles.reload();
                              }, "Deleted");
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <CreateRoleModal
          permissions={permissions.data ?? []}
          onClose={() => setCreating(false)}
          onCreate={(name, description, permissionKeys) =>
            guard(async () => {
              await core.createRole({
                name,
                ...(description ? { description } : {}),
                permissionKeys,
              });
              setCreating(false);
              roles.reload();
            }, "Role created")
          }
        />
      )}

      {editing && (
        <PermissionsModal
          role={editing}
          permissions={permissions.data ?? []}
          onClose={() => setEditing(null)}
          onSave={(permissionKeys) =>
            guard(async () => {
              await core.setRolePermissions({
                roleId: editing.id,
                permissionKeys,
              });
              setEditing(null);
              roles.reload();
            }, "Permissions updated")
          }
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function PermissionCheckboxes({
  permissions,
  selected,
  toggle,
}: {
  permissions: Permission[];
  selected: Set<string>;
  toggle: (key: string) => void;
}) {
  return (
    <div className="perm-grid">
      {permissions.map((p) => (
        <label key={p.key} className="perm-row">
          <input
            type="checkbox"
            checked={selected.has(p.key)}
            onChange={() => toggle(p.key)}
          />
          <span>
            <span className="mono">{p.key}</span>
            <span className="muted"> — {p.label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateRoleModal({
  permissions,
  onClose,
  onCreate,
}: {
  permissions: Permission[];
  onClose: () => void;
  onCreate: (name: string, description: string, keys: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <Modal
      title="New role"
      subtitle="Name the role and pick its permissions."
      onClose={onClose}
    >
      <Field label="Role name">
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <PermissionCheckboxes
        permissions={permissions}
        selected={selected}
        toggle={toggle}
      />
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={name.trim().length < 2}
          onClick={() =>
            onCreate(name.trim(), description.trim(), [...selected])
          }
        >
          Create role
        </Button>
      </div>
    </Modal>
  );
}

function PermissionsModal({
  role,
  permissions,
  onClose,
  onSave,
}: {
  role: Role;
  permissions: Permission[];
  onClose: () => void;
  onSave: (keys: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role.permissions.map((p) => p.key)),
  );
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <Modal
      title={`Permissions · ${role.name}`}
      subtitle="Tick the permissions this role grants."
      onClose={onClose}
    >
      <PermissionCheckboxes
        permissions={permissions}
        selected={selected}
        toggle={toggle}
      />
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave([...selected])}>
          Save permissions
        </Button>
      </div>
    </Modal>
  );
}
