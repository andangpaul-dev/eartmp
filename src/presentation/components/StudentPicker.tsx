/**
 * StudentPicker — type-ahead search over `listStudents` that resolves to a
 * selected Student. Shared by the Summary, Transcripts, and Graduation screens.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync } from "../runtime/hooks";
import type { Student } from "../../domain/entities";
import { Field } from "./ui";

export function StudentPicker({
  value,
  onChange,
  label = "Student",
}: {
  value: Student | null;
  onChange: (s: Student) => void;
  label?: string;
}) {
  const core = useCore();
  const [q, setQ] = useState("");
  const found = useAsync(
    () =>
      q.length >= 2
        ? core.listStudents({ where: { search: q }, take: 6 })
        : Promise.resolve(null),
    [q],
  );
  return (
    <Field label={label}>
      <input
        className="input"
        aria-label="Find student"
        placeholder={value ? value.fullName : "Search matric / name…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {found.data && found.data.items.length > 0 && (
        <div className="picker-pop">
          {found.data.items.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn ghost picker-opt"
              onClick={() => {
                onChange(s);
                setQ("");
              }}
            >
              <span className="mono">{s.matricNumber}</span>&nbsp;· {s.fullName}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
