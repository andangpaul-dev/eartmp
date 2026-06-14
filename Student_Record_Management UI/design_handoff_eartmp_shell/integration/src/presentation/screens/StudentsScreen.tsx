/**
 * EARTMP — Reference screen: Students (reconciled to the real CoreApi)
 * ============================================================================
 * Target: `src/presentation/screens/StudentsScreen.tsx`
 *
 * The canonical wiring pattern every screen copies:
 *   1. read   → useAsync(() => core.<method>(input), [deps])
 *   2. states → loading / error / empty / data — always all four
 *   3. gate   → can('permission') hides or disables actions (fail-closed)
 *   4. mutate → useAction(() => core.<method>(input), { onSuccess })
 *   5. confirm→ audited/irreversible actions go through a dialog
 *
 * Real names + inputs (read from the core):
 *   core.listStudents(StudentQuery) → Page<Student>
 *   core.admitStudent({ matricNumber, fullName, programmeId, levelId, fromSession })
 *   core.changeStudentStatus({ studentId, to })     // NOT { id, next }
 *
 * Port the prototype's markup (EARTMP.dc.html → Students) into the JSX where
 * marked; this file shows the DATA + CONTROL wiring the prototype mocks.
 */

import React, { useState } from "react";
import { useCore, useSession, useAsync, useAction } from "../runtime/react";
import type { Student } from "../../domain/entities";
import type { StudentStatus } from "../../domain/entities";
import type { StudentFilter } from "../../domain/repositories/records";
import { canTransition } from "../../domain/entities/student-status";

const PAGE_SIZE = 50;
const ALL_STATUSES: StudentStatus[] = [
  "ACTIVE",
  "SUSPENDED",
  "DEFERRED",
  "WITHDRAWN",
  "GRADUATED",
];

export function StudentsScreen() {
  const core = useCore();
  const { can } = useSession();

  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<StudentFilter>({ status: "ACTIVE" });
  const [admitOpen, setAdmitOpen] = useState(false);

  // 1. READ — ListStudents takes a StudentQuery; re-fetch on page/filter.
  const list = useAsync(
    () =>
      core.listStudents({
        where: filter,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    [page, filter],
  );

  return (
    <div>
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
      >
        <FilterBar
          filter={filter}
          onChange={(f) => {
            setPage(0);
            setFilter(f);
          }}
        />
        {/* 3. GATE — fail-closed; hidden unless the session holds the key. */}
        {can("students.create") && (
          <button onClick={() => setAdmitOpen(true)}>Admit student</button>
        )}
      </header>

      {/* 2. The four states — always all four, never just data. */}
      {list.loading && <SkeletonRows />}
      {list.error && (
        <ErrorPanel message={list.error.message} onRetry={list.reload} />
      )}
      {!list.loading &&
        !list.error &&
        list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState onClear={() => setFilter({})} />
        ) : (
          <>
            <StudentTable rows={list.data.items} onChanged={list.reload} />
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.total}
              onPage={setPage}
            />
          </>
        ))}

      {admitOpen && (
        <AdmitDialog
          onClose={() => setAdmitOpen(false)}
          onAdmitted={() => {
            setAdmitOpen(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

/* ───────────── Row with an audited status transition ─────────────── */

function StudentTable({
  rows,
  onChanged,
}: {
  rows: Student[];
  onChanged: () => void;
}) {
  return (
    <table>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td style={{ fontFamily: "IBM Plex Mono, monospace" }}>
              {s.matricNumber}
            </td>
            <td>{s.fullName}</td>
            <td>
              <StatusBadge status={s.status} />
            </td>
            <td>
              <StatusTransition student={s} onChanged={onChanged} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusTransition({
  student,
  onChanged,
}: {
  student: Student;
  onChanged: () => void;
}) {
  const core = useCore();
  const { can } = useSession();
  const [to, setTo] = useState<StudentStatus | "">("");
  const [confirm, setConfirm] = useState(false);

  // Mirror the core's guard so the UI only offers legal targets; the core
  // re-validates via canTransition on execute regardless.
  const options = ALL_STATUSES.filter(
    (s) => s !== student.status && canTransition(student.status, s),
  );

  const apply = useAction(
    () =>
      core.changeStudentStatus({
        studentId: student.id,
        to: to as StudentStatus,
      }),
    {
      onSuccess: () => {
        setConfirm(false);
        setTo("");
        onChanged();
      },
    },
  );

  if (!can("students.update") || options.length === 0) return null; // terminal / no perm

  return (
    <>
      <select
        value={to}
        onChange={(e) => setTo(e.target.value as StudentStatus)}
      >
        <option value="">Change status…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button disabled={!to} onClick={() => setConfirm(true)}>
        Apply
      </button>

      {/* 5. CONFIRM — audited status change with a stated consequence. */}
      {confirm && (
        <ConfirmDialog
          title={`Set status to ${to}?`}
          body="Recorded in the audit log. Only valid transitions are permitted."
          confirmLabel="Apply transition"
          pending={apply.pending}
          error={apply.error?.message}
          onCancel={() => setConfirm(false)}
          onConfirm={apply.run}
        />
      )}
    </>
  );
}

/* ───────────────── Admit form (real admitStudent input) ──────────── */

function AdmitDialog({
  onClose,
  onAdmitted,
}: {
  onClose: () => void;
  onAdmitted: () => void;
}) {
  const core = useCore();
  const [form, setForm] = useState({
    matricNumber: "",
    fullName: "",
    regNumber: "",
    programmeId: "",
    levelId: "",
    fromSession: "",
  });

  const submit = useAction(
    () =>
      core.admitStudent({
        matricNumber: form.matricNumber,
        fullName: form.fullName,
        regNumber: form.regNumber || undefined,
        programmeId: form.programmeId,
        levelId: form.levelId,
        fromSession: form.fromSession, // entry session, e.g. "2024/2025"
      }),
    { onSuccess: onAdmitted },
  );

  // Duplicate matric arrives as CoreError code "CONFLICT".
  const conflict = submit.error?.code === "CONFLICT";

  return (
    <Dialog title="Admit student" onClose={onClose}>
      <Field
        label="Matric number"
        required
        error={conflict ? submit.error?.message : undefined}
      >
        <input
          value={form.matricNumber}
          onChange={(e) => setForm({ ...form, matricNumber: e.target.value })}
        />
      </Field>
      <Field label="Full name" required>
        <input
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
      </Field>
      {/* programme / level / entry-session selects bind to config lists. */}

      {submit.error && !conflict && <p role="alert">{submit.error.message}</p>}

      <footer>
        <button onClick={onClose}>Cancel</button>
        <button disabled={submit.pending} onClick={submit.run}>
          {submit.pending ? "Admitting…" : "Admit & enroll"}
        </button>
      </footer>
    </Dialog>
  );
}

/* ── placeholders — swap for the prototype's real components ───────── */
function FilterBar(_: {
  filter: StudentFilter;
  onChange: (f: StudentFilter) => void;
}) {
  return null;
}
function StatusBadge(_: { status: StudentStatus }) {
  return null;
}
function SkeletonRows() {
  return <p>Loading…</p>;
}
function EmptyState(_: { onClear: () => void }) {
  return <p>No students match.</p>;
}
function ErrorPanel(p: { message: string; onRetry: () => void }) {
  return <p role="alert">{p.message}</p>;
}
function Pager(_: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return null;
}
function Dialog(p: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return <div role="dialog">{p.children}</div>;
}
function ConfirmDialog(_: {
  title: string;
  body: string;
  confirmLabel: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return null;
}
function Field(p: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return <label>{p.children}</label>;
}
