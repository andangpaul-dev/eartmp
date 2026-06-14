/**
 * Graduation — evaluate a student against the configured requirements (every
 * criterion shows required vs actual vs met, so a rejection explains itself),
 * then clear an eligible student. Clearing is irreversible (ACTIVE → GRADUATED)
 * and goes through a confirm dialog. All numbers come from the core.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { StudentPicker } from "../components/StudentPicker";
import {
  Button,
  Card,
  Badge,
  Modal,
  Toast,
  EmptyState,
  Icon,
} from "../components/ui";
import type { Student } from "../../domain/entities";

export function GraduationScreen() {
  const core = useCore();
  const { can } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const report = useAsync(
    () =>
      student
        ? core.evaluateGraduation({ studentId: student.id })
        : Promise.resolve(null),
    [student?.id],
  );

  const graduate = useAction(
    () => core.graduateStudent({ studentId: student!.id }),
    {
      onSuccess: (r) => {
        setConfirm(false);
        report.reload();
        notify(`Cleared — status ${r.status}`);
      },
    },
  );

  const graduated = student?.status === "GRADUATED";

  return (
    <div className="stack">
      <Card>
        <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          <StudentPicker value={student} onChange={setStudent} />
        </div>
      </Card>

      {!student ? (
        <EmptyState
          title="Pick a student"
          hint="Evaluate eligibility against the configured graduation requirements."
        />
      ) : report.loading ? (
        <Card>
          <div className="muted" style={{ padding: 16 }}>
            Evaluating…
          </div>
        </Card>
      ) : report.error ? (
        <Card>
          <div className="alert danger">{report.error.message}</div>
        </Card>
      ) : report.data ? (
        <Card>
          <div className="spread" style={{ marginBottom: 14 }}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>
                {student.fullName}
              </div>
              <div className="muted mono">{student.matricNumber}</div>
            </div>
            {report.data.eligible ? (
              <Badge tone="success">Eligible</Badge>
            ) : (
              <Badge tone="warn">Not yet eligible</Badge>
            )}
          </div>

          <table className="data">
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Required</th>
                <th>Actual</th>
                <th>Met</th>
              </tr>
            </thead>
            <tbody>
              {report.data.criteria.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="mono">{String(c.required)}</td>
                  <td className="mono">{String(c.actual)}</td>
                  <td>
                    {c.met ? (
                      <span className="verify-ok">
                        <Icon name="check" size={14} /> Yes
                      </span>
                    ) : (
                      <span className="verify-bad">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="actions" style={{ marginTop: 16 }}>
            {graduated ? (
              <Badge tone="info">Already graduated</Badge>
            ) : (
              can("graduation.clear") && (
                <Button
                  variant="primary"
                  disabled={!report.data.eligible}
                  title={
                    report.data.eligible
                      ? undefined
                      : "All criteria must be met"
                  }
                  onClick={() => setConfirm(true)}
                >
                  Clear for graduation
                </Button>
              )
            )}
          </div>
        </Card>
      ) : null}

      {confirm && (
        <Modal
          title="Clear this student for graduation?"
          subtitle="This transitions the student to GRADUATED. It is irreversible and recorded in the audit log."
          onClose={() => setConfirm(false)}
        >
          {graduate.error && (
            <div className="alert danger">{graduate.error.message}</div>
          )}
          <div className="actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={graduate.loading}
              onClick={graduate.run}
            >
              Graduate student
            </Button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
