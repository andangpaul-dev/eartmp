/**
 * Students — the reference screen. Proves the whole pattern end to end:
 * read (4 states) → permission-gated actions → admit (mutate, CONFLICT on a
 * duplicate matric) → status transition offering only `canTransition` targets →
 * confirm. The host re-checks every permission; the UI only mirrors what it
 * granted.
 */
import { useMemo, useState, type ReactNode } from "react";
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
import type { Student, StudentStatus } from "../../domain/entities";
import {
  canTransition,
  STUDENT_STATUS_TRANSITIONS,
} from "../../domain/entities/student-status";

const STATUSES: StudentStatus[] = [
  "ACTIVE",
  "SUSPENDED",
  "DEFERRED",
  "WITHDRAWN",
  "GRADUATED",
];

const STATUS_TONE: Record<StudentStatus, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warn",
  DEFERRED: "neutral",
  WITHDRAWN: "danger",
  GRADUATED: "info",
};

const PAGE = 12;

export function StudentsScreen() {
  const core = useCore();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StudentStatus | "">("");
  const [page, setPage] = useState(0);
  const [admitting, setAdmitting] = useState(false);
  const [selected, setSelected] = useState<Student | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const where = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    }),
    [search, status],
  );

  const list = useAsync(
    () => core.listStudents({ where, skip: page * PAGE, take: PAGE }),
    [where, page],
  );

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div className="stack">
      <Card>
        <div className="spread" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <input
              className="input"
              style={{ width: 240 }}
              aria-label="Search students by matric or name"
              placeholder="Search matric or name…"
              value={search}
              onChange={(e) => {
                setPage(0);
                setSearch(e.target.value);
              }}
            />
            <select
              className="select"
              style={{ width: 150 }}
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setPage(0);
                setStatus(e.target.value as StudentStatus | "");
              }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {can("students.create") && (
            <Button variant="primary" onClick={() => setAdmitting(true)}>
              <Icon name="plus" size={15} /> Admit student
            </Button>
          )}
        </div>

        {/* four states */}
        {list.loading ? (
          <div className="muted" style={{ padding: 24 }}>
            Loading students…
          </div>
        ) : list.error ? (
          <div className="alert danger">{list.error.message}</div>
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            title="No students"
            hint={
              search || status
                ? "No students match your filters."
                : "Admit your first student to get started."
            }
          />
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>Matric</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Admitted</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((s) => (
                  <tr
                    key={s.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(s)}
                  >
                    <td className="mono">{s.matricNumber}</td>
                    <td>{s.fullName}</td>
                    <td>
                      <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                    </td>
                    <td className="mono muted">{s.admissionSession ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="spread" style={{ marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {page * PAGE + 1}–{page * PAGE + list.data.items.length} of{" "}
                {list.data.total}
              </span>
              <div className="row">
                <Button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <Button
                  disabled={(page + 1) * PAGE >= list.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {admitting && (
        <AdmitModal
          onClose={() => setAdmitting(false)}
          onDone={() => {
            setAdmitting(false);
            list.reload();
            notify("Student admitted");
          }}
        />
      )}

      {selected && (
        <ProfileModal
          student={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            list.reload();
            notify("Status updated");
          }}
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

// ---- Admit (cascade: faculty → department → programme → level + session) ----

function AdmitModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [matricNumber, setMatric] = useState("");
  const [fullName, setFullName] = useState("");
  const [regNumber, setReg] = useState("");
  const [facultyId, setFaculty] = useState("");
  const [departmentId, setDepartment] = useState("");
  const [programmeId, setProgramme] = useState("");
  const [levelId, setLevel] = useState("");
  const [fromSession, setSession] = useState("");

  const faculties = useAsync(() => core.listFaculties({}), []);
  const departments = useAsync(
    () =>
      facultyId ? core.listDepartments({ facultyId }) : Promise.resolve([]),
    [facultyId],
  );
  const programmes = useAsync(
    () =>
      departmentId
        ? core.listProgrammes({ departmentId })
        : Promise.resolve([]),
    [departmentId],
  );
  const levels = useAsync(
    () =>
      programmeId ? core.listLevels({ programmeId }) : Promise.resolve([]),
    [programmeId],
  );
  const sessions = useAsync(() => core.listSessions({}), []);

  const submit = useAction(
    () =>
      core.admitStudent({
        matricNumber,
        fullName,
        ...(regNumber ? { regNumber } : {}),
        programmeId,
        levelId,
        fromSession,
      }),
    { onSuccess: onDone },
  );

  // Prefer per-field messages from the host (CoreError.fields); fall back to
  // mapping a bare CONFLICT to the matric field (its only unique key).
  const matricError =
    submit.error?.fields?.matricNumber ??
    (submit.error?.code === "CONFLICT" ? submit.error.message : undefined);
  const fullNameError = submit.error?.fields?.fullName;
  const valid =
    matricNumber && fullName && programmeId && levelId && fromSession;

  return (
    <Modal
      title="Admit student"
      subtitle="Creates the record and its first enrollment atomically."
      onClose={onClose}
    >
      <Field label="Matric number" error={matricError}>
        <input
          className="input mono"
          value={matricNumber}
          onChange={(e) => setMatric(e.target.value)}
        />
      </Field>
      <Field label="Full name" error={fullNameError}>
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field label="Registration number (optional)">
        <input
          className="input mono"
          value={regNumber}
          onChange={(e) => setReg(e.target.value)}
        />
      </Field>

      <div className="form-grid">
        <Cascade
          label="Faculty"
          value={facultyId}
          options={faculties.data}
          onChange={(v) => {
            setFaculty(v);
            setDepartment("");
            setProgramme("");
            setLevel("");
          }}
        />
        <Cascade
          label="Department"
          value={departmentId}
          options={departments.data}
          disabled={!facultyId}
          onChange={(v) => {
            setDepartment(v);
            setProgramme("");
            setLevel("");
          }}
        />
        <Cascade
          label="Programme"
          value={programmeId}
          options={programmes.data}
          disabled={!departmentId}
          onChange={(v) => {
            setProgramme(v);
            setLevel("");
          }}
        />
        <Cascade
          label="Level"
          value={levelId}
          options={levels.data}
          disabled={!programmeId}
          onChange={setLevel}
        />
      </div>
      <Field label="Admission session">
        <select
          className="select"
          value={fromSession}
          onChange={(e) => setSession(e.target.value)}
          disabled={!sessions.data?.length}
        >
          <option value="">
            {sessions.data?.length ? "Select…" : "No sessions configured"}
          </option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      {submit.error && !matricError && !fullNameError && (
        <div className="alert danger">{submit.error.message}</div>
      )}

      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!valid}
          loading={submit.loading}
          onClick={submit.run}
        >
          Admit
        </Button>
      </div>
    </Modal>
  );
}

function Cascade({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[] | null;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <select
        className="select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{disabled ? "—" : "Select…"}</option>
        {options?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

// ---- Profile + status transition (only canTransition targets) ----

function ProfileModal({
  student,
  onClose,
  onChanged,
}: {
  student: Student;
  onClose: () => void;
  onChanged: () => void;
}) {
  const core = useCore();
  const { can } = useSession();
  const [to, setTo] = useState<StudentStatus | "">("");
  const [confirm, setConfirm] = useState(false);

  const targets = STUDENT_STATUS_TRANSITIONS[student.status].filter((t) =>
    canTransition(student.status, t),
  );

  const change = useAction(
    () =>
      core.changeStudentStatus({
        studentId: student.id,
        to: to as StudentStatus,
      }),
    { onSuccess: onChanged },
  );

  return (
    <Modal
      title={student.fullName}
      subtitle={student.matricNumber}
      onClose={onClose}
    >
      <div className="stack" style={{ gap: 10 }}>
        <Row
          k="Status"
          v={<Badge tone={STATUS_TONE[student.status]}>{student.status}</Badge>}
        />
        <Row
          k="Programme"
          v={<span className="mono">{student.programmeId ?? "—"}</span>}
        />
        <Row
          k="Level"
          v={<span className="mono">{student.levelId ?? "—"}</span>}
        />
        <Row
          k="Admitted"
          v={<span className="mono">{student.admissionSession ?? "—"}</span>}
        />
      </div>

      {can("students.update") && (
        <div
          style={{
            marginTop: 18,
            borderTop: "1px solid var(--hairline)",
            paddingTop: 16,
          }}
        >
          {targets.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>
              {student.status} is a terminal state — no further transitions.
            </div>
          ) : (
            <div className="row" style={{ gap: 10 }}>
              <select
                className="select"
                style={{ width: 200 }}
                aria-label="Change status to"
                value={to}
                onChange={(e) => setTo(e.target.value as StudentStatus)}
              >
                <option value="">Change status to…</option>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={!to}
                onClick={() => setConfirm(true)}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      )}

      {confirm && to && (
        <Modal
          title={`Set status to ${to}?`}
          subtitle={
            to === "GRADUATED" || to === "WITHDRAWN"
              ? "This is a terminal state and cannot be reversed."
              : "This change is recorded in the audit log."
          }
          onClose={() => setConfirm(false)}
        >
          {change.error && (
            <div className="alert danger">{change.error.message}</div>
          )}
          <div className="actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={change.loading}
              onClick={change.run}
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="spread" style={{ fontSize: 13 }}>
      <span className="muted">{k}</span>
      {v}
    </div>
  );
}
