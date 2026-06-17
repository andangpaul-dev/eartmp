/**
 * Institutions — manage the universities/institutions and view each one's
 * organigram (Faculties → Departments). The default institution drives
 * transcripts. Writes gated institution.manage; reads need settings.read.
 * Faculties/departments themselves are created in the Structure screen (scoped
 * to an institution); here they are listed read-only beneath their institution.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
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
import type { Institution, Faculty } from "../runtime/contract";

const CALENDARS = ["SEMESTER", "TRIMESTER", "QUARTER"] as const;

export function InstitutionsScreen() {
  const core = useCore();
  const { can } = useSession();
  const manage = can("institution.manage");
  const [creating, setCreating] = useState(false);
  const [editFor, setEditFor] = useState<Institution | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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

  const institutions = useAsync(() => core.listInstitutions({}), []);
  const faculties = useAsync(() => core.listFaculties({}), []);
  const reloadAll = () => {
    institutions.reload();
    faculties.reload();
  };

  const facultiesOf = (institutionId: string): Faculty[] =>
    (faculties.data ?? []).filter((f) => f.institutionId === institutionId);
  const unassigned = (faculties.data ?? []).filter((f) => !f.institutionId);

  return (
    <div className="stack">
      <Card>
        <div className="spread">
          <span className="muted">
            Each institution owns its faculties & departments. The{" "}
            <strong>default</strong> institution is used on transcripts.
          </span>
          {manage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New institution
            </Button>
          )}
        </div>
      </Card>

      {institutions.loading ? (
        <Card>
          <div className="muted">Loading…</div>
        </Card>
      ) : (institutions.data?.length ?? 0) === 0 ? (
        <Card>
          <div className="muted">
            No institutions yet. Create one to start building its organigram.
          </div>
        </Card>
      ) : (
        institutions.data!.map((inst) => (
          <InstitutionCard
            key={inst.id}
            inst={inst}
            faculties={facultiesOf(inst.id)}
            canManage={manage}
            onSetDefault={() =>
              guard(async () => {
                await core.setDefaultInstitution({ id: inst.id });
                institutions.reload();
              }, `${inst.name} is now the default`)
            }
            onEdit={() => setEditFor(inst)}
            onDelete={() => {
              if (window.confirm(`Delete "${inst.name}"?`))
                guard(async () => {
                  await core.deleteInstitution({ id: inst.id });
                  reloadAll();
                }, "Deleted");
            }}
          />
        ))
      )}

      {unassigned.length > 0 && (
        <Card title="Unassigned faculties">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            These faculties aren’t linked to an institution. Assign them from
            the Structure screen.
          </div>
          <ul className="picklist">
            {unassigned.map((f) => (
              <li key={f.id} className="picklist-row">
                <span className="picklist-main">
                  <span className="mono">{f.code}</span> {f.name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && (
        <CreateInstitutionModal
          onClose={() => setCreating(false)}
          onCreate={(name, code, calendarType) =>
            guard(async () => {
              await core.createInstitution({
                name,
                ...(code ? { code } : {}),
                calendarType,
              });
              setCreating(false);
              institutions.reload();
            }, "Institution created")
          }
        />
      )}

      {editFor && (
        <EditInstitutionModal
          inst={editFor}
          onClose={() => setEditFor(null)}
          onSave={(patch) =>
            guard(async () => {
              await core.updateInstitutionById({ id: editFor.id, patch });
              setEditFor(null);
              institutions.reload();
            }, "Institution updated")
          }
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function EditInstitutionModal({
  inst,
  onClose,
  onSave,
}: {
  inst: Institution;
  onClose: () => void;
  onSave: (patch: Partial<Institution>) => void;
}) {
  const [name, setName] = useState(inst.name);
  const [code, setCode] = useState(inst.code ?? "");
  const [calendarType, setCalendarType] = useState<string>(inst.calendarType);
  const [motto, setMotto] = useState(inst.motto ?? "");
  const [accreditationNo, setAccreditationNo] = useState(
    inst.accreditationNo ?? "",
  );
  const [address, setAddress] = useState(inst.address ?? "");
  const [telephone, setTelephone] = useState(inst.telephone ?? "");
  const [email, setEmail] = useState(inst.email ?? "");
  const [website, setWebsite] = useState(inst.website ?? "");
  const [rule, setRule] = useState(inst.transcriptNumberRule ?? "");

  return (
    <Modal
      title={`Edit · ${inst.name}`}
      subtitle="Identity & branding used on this institution's transcripts."
      onClose={onClose}
    >
      <div className="form-grid">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Code">
          <input
            className="input mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <Field label="Academic calendar">
          <select
            className="select"
            aria-label="Academic calendar"
            value={calendarType}
            onChange={(e) => setCalendarType(e.target.value)}
          >
            {CALENDARS.map((c) => (
              <option key={c} value={c}>
                {c.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Accreditation no.">
          <input
            className="input"
            value={accreditationNo}
            onChange={(e) => setAccreditationNo(e.target.value)}
          />
        </Field>
        <Field label="Telephone">
          <input
            className="input"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
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
        <Field label="Website">
          <input
            className="input"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </Field>
        <Field label="Transcript number rule">
          <input
            className="input mono"
            placeholder="TR-{year}-{seq:000000}"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Motto">
        <input
          className="input"
          value={motto}
          onChange={(e) => setMotto(e.target.value)}
        />
      </Field>
      <Field label="Address">
        <input
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={name.trim().length === 0}
          onClick={() =>
            onSave({
              name: name.trim(),
              code: code.trim() || undefined,
              calendarType: calendarType as Institution["calendarType"],
              motto: motto.trim() || undefined,
              accreditationNo: accreditationNo.trim() || undefined,
              address: address.trim() || undefined,
              telephone: telephone.trim() || undefined,
              email: email.trim() || undefined,
              website: website.trim() || undefined,
              transcriptNumberRule: rule.trim() || undefined,
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function InstitutionCard({
  inst,
  faculties,
  canManage,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  inst: Institution;
  faculties: Faculty[];
  canManage: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <strong style={{ fontSize: 15 }}>{inst.name}</strong>
          {inst.code && <span className="mono muted">{inst.code}</span>}
          {inst.isDefault && (
            <Badge tone="success">
              <Icon name="check" size={12} /> Default
            </Badge>
          )}
        </div>
        {canManage && (
          <div className="row" style={{ gap: 6 }}>
            {!inst.isDefault && (
              <Button variant="ghost" onClick={onSetDefault}>
                Make default
              </Button>
            )}
            <Button variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="danger"
              disabled={inst.isDefault || faculties.length > 0}
              title={
                inst.isDefault
                  ? "Set another institution as default first"
                  : faculties.length > 0
                    ? "Remove its faculties first"
                    : undefined
              }
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
      {faculties.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          No faculties yet — add them in the Structure screen.
        </div>
      ) : (
        <ul className="org-tree">
          {faculties.map((f) => (
            <FacultyNode key={f.id} faculty={f} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function FacultyNode({ faculty }: { faculty: Faculty }) {
  const core = useCore();
  const [open, setOpen] = useState(false);
  const departments = useAsync(
    () =>
      open
        ? core.listDepartments({ facultyId: faculty.id })
        : Promise.resolve([]),
    [open],
  );
  return (
    <li>
      <button className="org-faculty" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "chevron" : "chevron"} size={12} />
        <span className="mono">{faculty.code}</span> {faculty.name}
      </button>
      {open && (
        <ul className="org-depts">
          {departments.loading ? (
            <li className="muted">Loading…</li>
          ) : (departments.data?.length ?? 0) === 0 ? (
            <li className="muted">No departments</li>
          ) : (
            departments.data!.map((d) => (
              <li key={d.id}>
                <span className="mono">{d.code}</span> {d.name}
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  );
}

function CreateInstitutionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, code: string, calendarType: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [calendarType, setCalendarType] = useState<string>("SEMESTER");
  return (
    <Modal
      title="New institution"
      subtitle="A university/institution that owns faculties & departments."
      onClose={onClose}
    >
      <Field label="Name">
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Code (optional)">
        <input
          className="input mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Field label="Academic calendar">
        <select
          className="select"
          aria-label="Academic calendar"
          value={calendarType}
          onChange={(e) => setCalendarType(e.target.value)}
        >
          {CALENDARS.map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </select>
      </Field>
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={name.trim().length === 0}
          onClick={() => onCreate(name.trim(), code.trim(), calendarType)}
        >
          Create
        </Button>
      </div>
    </Modal>
  );
}
