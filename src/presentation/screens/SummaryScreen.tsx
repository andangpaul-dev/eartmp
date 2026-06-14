/**
 * Academic summary — per-semester GPA and the cumulative CGPA. CGPA is a
 * display-only aggregate of stored quality points (2 dp), never a mean of
 * semester GPAs; every number here comes from the core. Read-only.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import { StudentPicker } from "../components/StudentPicker";
import { Card, Badge, EmptyState } from "../components/ui";
import type { Student } from "../../domain/entities";

export function SummaryScreen() {
  const core = useCore();
  const [student, setStudent] = useState<Student | null>(null);
  const summary = useAsync(
    () =>
      student
        ? core.getAcademicSummary({ studentId: student.id })
        : Promise.resolve(null),
    [student?.id],
  );

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
          hint="Search to view their semester GPAs and cumulative CGPA."
        />
      ) : summary.loading ? (
        <Card>
          <div className="muted" style={{ padding: 16 }}>
            Loading…
          </div>
        </Card>
      ) : summary.error ? (
        <Card>
          <div className="alert danger">{summary.error.message}</div>
        </Card>
      ) : summary.data ? (
        <>
          <Card>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="card-title" style={{ margin: 0 }}>
                  {student.fullName}
                </div>
                <div className="muted mono">{student.matricNumber}</div>
              </div>
              <Badge tone="info">{summary.data.standing}</Badge>
            </div>
            <div className="stat-row">
              <Stat label="CGPA" value={summary.data.cgpa.toFixed(2)} strong />
              <Stat
                label="Credits earned"
                value={`${summary.data.creditsEarned} / ${summary.data.creditsAttempted}`}
              />
              <Stat
                label="Quality points"
                value={summary.data.totalQualityPoints.toFixed(1)}
              />
              <Stat label="Semesters" value={summary.data.semesters.length} />
            </div>
          </Card>

          <Card title="Per-semester GPA">
            {summary.data.semesters.length === 0 ? (
              <EmptyState
                title="No processed semesters"
                hint="Process a semester's results to see it here."
              />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Semester</th>
                    <th>Credits (earned / attempted)</th>
                    <th>Quality points</th>
                    <th>GPA</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.semesters.map((s) => (
                    <tr key={s.semesterId}>
                      <td className="mono">{s.semesterId.slice(0, 8)}</td>
                      <td className="mono">
                        {s.creditsEarned} / {s.creditsAttempted}
                      </td>
                      <td className="mono">{s.qualityPoints.toFixed(1)}</td>
                      <td className="mono strong">{s.gpa.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | number;
  strong?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${strong ? "strong" : ""}`}>{value}</div>
    </div>
  );
}
