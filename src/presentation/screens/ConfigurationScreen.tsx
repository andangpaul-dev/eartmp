/**
 * Configuration — institution profile, grading configuration (grade scales &
 * assessment structures, runtime-configured, never hardcoded), graduation
 * requirements, and signing-key security. Reads are gated by `*.read`; writes
 * by `*.manage`. All values come from and go to the core.
 */
import { useEffect, useState, type ReactNode } from "react";
import { expandMatricule } from "../../domain/services/Matricule";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { useAsync, useAction } from "../runtime/hooks";
import {
  Button,
  Card,
  Badge,
  Field,
  Modal,
  Toast,
  EmptyState,
} from "../components/ui";
import type {
  Institution,
  StoredGradeScale,
  StoredAssessmentConfig,
  GraduationRequirements,
} from "../runtime/contract";
import { validateBands, type BandRow } from "./grading/bandsValidation";
import {
  validateComponents,
  weightTotal,
  type ComponentRow,
} from "./grading/componentsValidation";

const CALENDAR_TYPES = ["SEMESTER", "TRIMESTER", "QUARTER"] as const;
const GRAD_KEY = "graduation.requirements";
const MATRIC_RULE_KEY = "student.matriculeRule";
const MATRIC_SCHEME_KEY = "student.matriculeCheckScheme";
const MATRIC_FORMAT_KEY = "student.matriculeFormat";
const STANDING_BANDS_KEY = "grading.standingBands";

const STANDING_BANDS_DEFAULT: StandingBandRow[] = [
  { label: "First Class", minGpa: 3.5 },
  { label: "Second Class Upper", minGpa: 3.0 },
  { label: "Second Class Lower", minGpa: 2.0 },
  { label: "Pass", minGpa: 1.0 },
  { label: "Fail", minGpa: 0 },
];

interface StandingBandRow {
  label: string;
  minGpa: number | string;
}

type Tab = "institution" | "grading" | "graduation" | "security" | "matricule";
const TABS: { key: Tab; label: string }[] = [
  { key: "institution", label: "Institution" },
  { key: "grading", label: "Grading" },
  { key: "graduation", label: "Graduation" },
  { key: "security", label: "Security" },
  { key: "matricule", label: "Matricule" },
];

export function ConfigurationScreen() {
  const [tab, setTab] = useState<Tab>("institution");
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "institution" && <InstitutionTab notify={notify} />}
      {tab === "grading" && <GradingTab notify={notify} />}
      {tab === "graduation" && <GraduationTab notify={notify} />}
      {tab === "security" && <SecurityTab notify={notify} />}
      {tab === "matricule" && <MatriculeTab notify={notify} />}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function InstitutionTab({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const inst = useAsync(() => core.getInstitution({}), []);
  const [patch, setPatch] = useState<Partial<Institution>>({});
  const editable = can("institution.manage");

  const save = useAction(() => core.updateInstitution({ patch }), {
    onSuccess: () => {
      setPatch({});
      inst.reload();
      notify("Institution profile saved");
    },
  });

  if (inst.loading)
    return (
      <Card>
        <div className="muted" style={{ padding: 16 }}>
          Loading…
        </div>
      </Card>
    );
  if (inst.error)
    return (
      <Card>
        <div className="alert danger">{inst.error.message}</div>
      </Card>
    );
  if (!inst.data) return <EmptyState title="Institution not provisioned" />;

  const v = { ...inst.data, ...patch };
  const set = (k: keyof Institution) => (e: { target: { value: string } }) =>
    setPatch((p) => ({ ...p, [k]: e.target.value }));

  return (
    <Card title="Institution profile">
      <div className="form-grid">
        <Field label="Name">
          <input
            className="input"
            value={v.name ?? ""}
            disabled={!editable}
            onChange={set("name")}
          />
        </Field>
        <Field label="Accreditation no.">
          <input
            className="input"
            value={v.accreditationNo ?? ""}
            disabled={!editable}
            onChange={set("accreditationNo")}
          />
        </Field>
        <Field label="Motto">
          <input
            className="input"
            value={v.motto ?? ""}
            disabled={!editable}
            onChange={set("motto")}
          />
        </Field>
        <Field label="Calendar type">
          <select
            className="select"
            aria-label="Calendar type"
            value={v.calendarType}
            disabled={!editable}
            onChange={(e) =>
              setPatch((p) => ({
                ...p,
                calendarType: e.target.value as Institution["calendarType"],
              }))
            }
          >
            {CALENDAR_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Address">
          <input
            className="input"
            value={v.address ?? ""}
            disabled={!editable}
            onChange={set("address")}
          />
        </Field>
        <Field label="Telephone">
          <input
            className="input"
            value={v.telephone ?? ""}
            disabled={!editable}
            onChange={set("telephone")}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            value={v.email ?? ""}
            disabled={!editable}
            onChange={set("email")}
          />
        </Field>
        <Field label="Website">
          <input
            className="input"
            value={v.website ?? ""}
            disabled={!editable}
            onChange={set("website")}
          />
        </Field>
        <Field label="Transcript number rule">
          <input
            className="input mono"
            value={v.transcriptNumberRule ?? ""}
            disabled={!editable}
            placeholder="TR-{year}-{seq:000000}"
            onChange={set("transcriptNumberRule")}
          />
        </Field>
      </div>
      {save.error && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {save.error.message}
        </div>
      )}
      {editable && (
        <div className="actions" style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            disabled={Object.keys(patch).length === 0}
            loading={save.loading}
            onClick={save.run}
          >
            Save changes
          </Button>
        </div>
      )}
    </Card>
  );
}

function GradingTab({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const scales = useAsync(() => core.listGradeScales({}), []);
  const configs = useAsync(() => core.listAssessmentConfigs({}), []);
  const manage = can("config.manage");

  // modal state: null = closed, "new" = creating, StoredGradeScale = editing
  const [scaleModal, setScaleModal] = useState<"new" | StoredGradeScale | null>(
    null,
  );
  // assessment modal state
  const [configModal, setConfigModal] = useState<
    "new" | StoredAssessmentConfig | null
  >(null);

  const setScaleDefault = async (s: StoredGradeScale) => {
    try {
      await core.setDefaultGradeScale({ id: s.id });
      scales.reload();
      notify(`"${s.name}" is now the default grade scale`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  const deleteScale = async (s: StoredGradeScale) => {
    try {
      await core.deleteGradeScale({ id: s.id });
      scales.reload();
      notify(`"${s.name}" deleted`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  const setConfigDefault = async (c: StoredAssessmentConfig) => {
    try {
      await core.setDefaultAssessmentConfig({ id: c.id });
      configs.reload();
      notify(`"${c.name}" is now the default assessment structure`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  const deleteConfig = async (c: StoredAssessmentConfig) => {
    try {
      await core.deleteAssessmentConfig({ id: c.id });
      configs.reload();
      notify(`"${c.name}" deleted`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <>
      <Card title="Grade scales">
        {manage && (
          <div style={{ marginBottom: 12 }}>
            <Button variant="primary" onClick={() => setScaleModal("new")}>
              New scale
            </Button>
          </div>
        )}
        <ListState
          loading={scales.loading}
          error={scales.error?.message}
          empty={(scales.data?.length ?? 0) === 0}
          emptyTitle="No grade scales configured"
        >
          <div className="stack" style={{ gap: 10 }}>
            {scales.data?.map((s) => (
              <GradeScaleConfigRow
                key={s.id}
                scale={s}
                canManage={manage}
                onSetDefault={() => setScaleDefault(s)}
                onEdit={() => setScaleModal(s)}
                onDelete={() => deleteScale(s)}
              />
            ))}
          </div>
        </ListState>
      </Card>

      <Card title="Assessment structures">
        {manage && (
          <div style={{ marginBottom: 12 }}>
            <Button variant="primary" onClick={() => setConfigModal("new")}>
              New structure
            </Button>
          </div>
        )}
        <ListState
          loading={configs.loading}
          error={configs.error?.message}
          empty={(configs.data?.length ?? 0) === 0}
          emptyTitle="No assessment structures configured"
        >
          <div className="stack" style={{ gap: 10 }}>
            {configs.data?.map((c) => (
              <AssessmentConfigRow
                key={c.id}
                config={c}
                canManage={manage}
                onSetDefault={() => setConfigDefault(c)}
                onEdit={() => setConfigModal(c)}
                onDelete={() => deleteConfig(c)}
              />
            ))}
          </div>
        </ListState>
      </Card>

      {scaleModal !== null && (
        <GradeScaleEditorModal
          initial={scaleModal === "new" ? null : scaleModal}
          onClose={() => setScaleModal(null)}
          onDone={() => {
            setScaleModal(null);
            scales.reload();
            notify(
              scaleModal === "new"
                ? "Grade scale created"
                : "Grade scale updated",
            );
          }}
        />
      )}

      {configModal !== null && (
        <AssessmentEditorModal
          initial={configModal === "new" ? null : configModal}
          onClose={() => setConfigModal(null)}
          onDone={() => {
            setConfigModal(null);
            configs.reload();
            notify(
              configModal === "new"
                ? "Assessment structure created"
                : "Assessment structure updated",
            );
          }}
        />
      )}

      <StandingBandsEditor notify={notify} />
    </>
  );
}

/** Per-row wrapper that renders BandsTable + Edit/Delete buttons for a scale. */
function GradeScaleConfigRow({
  scale,
  canManage,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  scale: StoredGradeScale;
  canManage: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="config-row">
      <div className="spread">
        <div className="row" style={{ gap: 10 }}>
          <strong>{scale.name}</strong>
          {scale.isDefault && <Badge tone="success">Default</Badge>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "View"}
          </Button>
          {canManage && !scale.isDefault && (
            <Button variant="ghost" onClick={onSetDefault}>
              Set default
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={onEdit}>
              Edit &ldquo;{scale.name}&rdquo;
            </Button>
          )}
          {canManage && (
            <Button
              variant="ghost"
              disabled={scale.isDefault}
              title={
                scale.isDefault ? "Cannot delete the default scale" : undefined
              }
              aria-label={`Delete "${scale.name}"`}
              onClick={onDelete}
            >
              Delete &ldquo;{scale.name}&rdquo;
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <BandsTable bands={scale.bands} />
        </div>
      )}
    </div>
  );
}

/** Blank band added by "Add band": starts where the last band left off. */
function blankBand(rows: BandRow[]): BandRow {
  const lastMax = rows.length > 0 ? (rows[rows.length - 1]?.maxMark ?? -1) : -1;
  return {
    minMark: lastMax + 1,
    maxMark: 100,
    grade: "",
    gradePoint: 0,
    isPass: true,
  };
}

/** Modal for creating or editing a grade scale (bands editor). */
function GradeScaleEditorModal({
  initial,
  onClose,
  onDone,
}: {
  initial: StoredGradeScale | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [name, setName] = useState(initial?.name ?? "");
  const [rows, setRows] = useState<BandRow[]>(() => {
    if (!initial)
      return [
        { minMark: 0, maxMark: 100, grade: "", gradePoint: 0, isPass: true },
      ];
    try {
      return JSON.parse(initial.bands) as BandRow[];
    } catch {
      return [];
    }
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validationErrors = validateBands(rows);
  const canSave = name.trim() !== "" && validationErrors.length === 0;

  const updateRow = (i: number, patch: Partial<BandRow>) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addBand = () => {
    setRows((prev) => [...prev, blankBand(prev)]);
  };

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      if (initial) {
        await core.updateGradeScale({ id: initial.id, name, bands: rows });
      } else {
        await core.createGradeScale({ name, bands: rows });
      }
      onDone();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={initial ? `Edit grade scale · ${initial.name}` : "New grade scale"}
      subtitle="Changes apply to future processing only — already-processed results keep their original grades."
      onClose={onClose}
    >
      <Field label="Scale name">
        <input
          className="input"
          aria-label="Scale name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Min mark</th>
              <th>Max mark</th>
              <th>Grade</th>
              <th>Grade point</th>
              <th>Pass?</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    aria-label="Min mark"
                    min={0}
                    max={100}
                    value={row.minMark}
                    onChange={(e) =>
                      updateRow(i, { minMark: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    aria-label="Max mark"
                    min={0}
                    max={100}
                    value={row.maxMark}
                    onChange={(e) =>
                      updateRow(i, { maxMark: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    aria-label="Grade"
                    value={row.grade}
                    onChange={(e) => updateRow(i, { grade: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    aria-label="Grade point"
                    min={0}
                    step={0.1}
                    value={row.gradePoint}
                    onChange={(e) =>
                      updateRow(i, { gradePoint: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label="Is pass"
                    checked={row.isPass}
                    onChange={(e) => updateRow(i, { isPass: e.target.checked })}
                  />
                </td>
                <td>
                  <Button variant="ghost" onClick={() => removeRow(i)}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" onClick={addBand}>
            Add band
          </Button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {validationErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {serverError && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}

      <div className="actions" style={{ marginTop: 16 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!canSave || saving}
          loading={saving}
          onClick={save}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

/** Per-row wrapper for an assessment config with Edit/Delete buttons. */
function AssessmentConfigRow({
  config,
  canManage,
  onSetDefault,
  onEdit,
  onDelete,
}: {
  config: StoredAssessmentConfig;
  canManage: boolean;
  onSetDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="config-row">
      <div className="spread">
        <div className="row" style={{ gap: 10 }}>
          <strong>{config.name}</strong>
          {config.isDefault && <Badge tone="success">Default</Badge>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "View"}
          </Button>
          {canManage && !config.isDefault && (
            <Button variant="ghost" onClick={onSetDefault}>
              Set default
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={onEdit}>
              Edit &ldquo;{config.name}&rdquo;
            </Button>
          )}
          {canManage && (
            <Button
              variant="ghost"
              disabled={config.isDefault}
              title={
                config.isDefault
                  ? "Cannot delete the default structure"
                  : undefined
              }
              aria-label={`Delete "${config.name}"`}
              onClick={onDelete}
            >
              Delete &ldquo;{config.name}&rdquo;
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <ComponentsTable components={config.components} />
        </div>
      )}
    </div>
  );
}

/** Blank component added by "Add component". */
function blankComponent(): ComponentRow {
  return { key: "", label: "", weight: 0, maxScore: 100 };
}

/** Modal for creating or editing an assessment structure (components editor). */
function AssessmentEditorModal({
  initial,
  onClose,
  onDone,
}: {
  initial: StoredAssessmentConfig | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const core = useCore();
  const [name, setName] = useState(initial?.name ?? "");
  const [rows, setRows] = useState<ComponentRow[]>(() => {
    if (!initial) return [blankComponent()];
    try {
      return JSON.parse(initial.components) as ComponentRow[];
    } catch {
      return [];
    }
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validationErrors = validateComponents(rows);
  const total = weightTotal(rows);
  const canSave = name.trim() !== "" && validationErrors.length === 0;

  const updateRow = (i: number, patch: Partial<ComponentRow>) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addComponent = () => {
    setRows((prev) => [...prev, blankComponent()]);
  };

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const components = rows.map((r) => ({
        key: r.key,
        label: r.label,
        weight: Number(r.weight),
        maxScore: Number(r.maxScore),
      }));
      if (initial) {
        await core.updateAssessmentConfig({ id: initial.id, name, components });
      } else {
        await core.createAssessmentConfig({ name, components });
      }
      onDone();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        initial
          ? `Edit assessment structure · ${initial.name}`
          : "New assessment structure"
      }
      subtitle="Changes apply to future processing only — already-processed results keep their original structure."
      onClose={onClose}
    >
      <Field label="Structure name">
        <input
          className="input"
          aria-label="Structure name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th>Weight (%)</th>
              <th>Max score</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input mono"
                    aria-label="Key"
                    value={row.key}
                    onChange={(e) => updateRow(i, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    aria-label="Label"
                    value={row.label}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    aria-label="Weight"
                    min={0}
                    max={100}
                    value={row.weight}
                    onChange={(e) =>
                      updateRow(i, { weight: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    className="input mono"
                    type="number"
                    aria-label="Max score"
                    min={1}
                    value={row.maxScore}
                    onChange={(e) =>
                      updateRow(i, { maxScore: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <Button
                    variant="ghost"
                    aria-label={`Remove component ${i + 1}`}
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" onClick={addComponent}>
            Add component
          </Button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Total weight:{" "}
        </span>
        <output
          aria-label="Total weight"
          className={`mono strong ${Math.abs(total - 100) < 1e-6 ? "" : "weight-bad"}`}
        >
          {total}%
        </output>
      </div>

      {validationErrors.length > 0 && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {validationErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {serverError && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}

      <div className="actions" style={{ marginTop: 16 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!canSave || saving}
          loading={saving}
          onClick={save}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function validateStandingBands(rows: StandingBandRow[]): string[] {
  const errors: string[] = [];
  if (rows.length === 0) errors.push("At least one band is required.");
  rows.forEach((r, i) => {
    if (!r.label.trim()) errors.push(`Row ${i + 1}: label cannot be empty.`);
    if (!isFinite(Number(r.minGpa)))
      errors.push(`Row ${i + 1}: Min GPA must be a number.`);
  });
  return errors;
}

function StandingBandsEditor({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const manage = can("config.manage");

  const [rows, setRows] = useState<StandingBandRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    core.getSetting({ key: STANDING_BANDS_KEY }).then((val) => {
      if (!alive) return;
      if (Array.isArray(val) && val.length > 0) {
        setRows(val as StandingBandRow[]);
      } else {
        setRows(STANDING_BANDS_DEFAULT);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const validationErrors = validateStandingBands(rows);
  const canSave = manage && validationErrors.length === 0;

  const updateRow = (i: number, patch: Partial<StandingBandRow>) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addBand = () => {
    setRows((prev) => [...prev, { label: "", minGpa: 0 }]);
  };

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      await core.setSetting({
        key: STANDING_BANDS_KEY,
        value: rows.map((r) => ({
          label: r.label,
          minGpa: Number(r.minGpa),
        })),
      });
      notify("Classification bands saved");
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded)
    return (
      <Card title="Classification (standing) bands">
        <div className="muted" style={{ padding: 16 }}>
          Loading…
        </div>
      </Card>
    );

  return (
    <Card title="Classification (standing) bands">
      <div className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
        Changes apply to future GPA processing only — already-processed results
        keep their original classification.
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Label</th>
            <th>Min GPA</th>
            {manage && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input"
                  aria-label="Classification label"
                  value={row.label}
                  disabled={!manage}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input mono"
                  type="number"
                  aria-label="Min GPA"
                  step={0.1}
                  min={0}
                  value={row.minGpa}
                  disabled={!manage}
                  onChange={(e) => updateRow(i, { minGpa: e.target.value })}
                />
              </td>
              {manage && (
                <td>
                  <Button
                    variant="ghost"
                    aria-label={`Remove standing band ${i + 1}`}
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {manage && (
        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" onClick={addBand}>
            Add band
          </Button>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {validationErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {serverError && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {serverError}
        </div>
      )}

      {manage && (
        <div className="actions" style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            disabled={!canSave || saving}
            loading={saving}
            onClick={save}
          >
            Save classification bands
          </Button>
        </div>
      )}
    </Card>
  );
}

function GraduationTab({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const req = useAsync(
    () => core.getSetting({ key: GRAD_KEY }) as Promise<GraduationRequirements>,
    [],
  );
  const [patch, setPatch] = useState<Partial<GraduationRequirements>>({});
  const manage = can("settings.manage");

  const save = useAction(
    () =>
      core.setSetting({
        key: GRAD_KEY,
        value: { ...(req.data as GraduationRequirements), ...patch },
      }),
    {
      onSuccess: () => {
        setPatch({});
        req.reload();
        notify("Graduation requirements saved");
      },
    },
  );

  if (req.loading)
    return (
      <Card>
        <div className="muted" style={{ padding: 16 }}>
          Loading…
        </div>
      </Card>
    );
  if (req.error)
    return (
      <Card>
        <div className="alert danger">{req.error.message}</div>
      </Card>
    );

  const v = { ...(req.data as GraduationRequirements), ...patch };
  return (
    <Card title="Graduation requirements">
      <div className="form-grid">
        <Field label="Minimum CGPA">
          <input
            className="input mono"
            type="number"
            step="0.01"
            value={v.minCgpa}
            disabled={!manage}
            onChange={(e) =>
              setPatch((p) => ({ ...p, minCgpa: Number(e.target.value) }))
            }
          />
        </Field>
        <Field label="Minimum credits earned">
          <input
            className="input mono"
            type="number"
            value={v.minCreditsEarned}
            disabled={!manage}
            onChange={(e) =>
              setPatch((p) => ({
                ...p,
                minCreditsEarned: Number(e.target.value),
              }))
            }
          />
        </Field>
        <Field label="No outstanding fails required">
          <select
            className="select"
            aria-label="No outstanding fails required"
            value={v.requireNoOutstandingFails ? "yes" : "no"}
            disabled={!manage}
            onChange={(e) =>
              setPatch((p) => ({
                ...p,
                requireNoOutstandingFails: e.target.value === "yes",
              }))
            }
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
      </div>
      {save.error && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {save.error.message}
        </div>
      )}
      {manage && (
        <div className="actions" style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            disabled={Object.keys(patch).length === 0}
            loading={save.loading}
            onClick={save.run}
          >
            Save requirements
          </Button>
        </div>
      )}
    </Card>
  );
}

function SecurityTab({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const { sealed } = useKeyState();
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const rotate = useAction(
    () =>
      core.changeKeyPassphrase({ oldPassphrase: oldP, newPassphrase: newP }),
    {
      onSuccess: () => {
        setOldP("");
        setNewP("");
        notify("Signing-key passphrase rotated");
      },
    },
  );
  const changePw = useAction(
    () => core.changePassword({ oldPassword: oldPw, newPassword: newPw }),
    {
      onSuccess: () => {
        setOldPw("");
        setNewPw("");
        notify("Password changed");
      },
    },
  );

  return (
    <>
      <Card title="My password">
        <div className="form-grid">
          <Field label="Current password">
            <input
              className="input"
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
            />
          </Field>
          <Field label="New password">
            <input
              className="input"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </Field>
        </div>
        {changePw.error && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            {changePw.error.message}
          </div>
        )}
        <div className="actions" style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            disabled={!oldPw || !newPw}
            loading={changePw.loading}
            onClick={changePw.run}
          >
            Change password
          </Button>
        </div>
      </Card>

      {can("security.manage") && (
        <Card title="Transcript signing-key passphrase">
          <div className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>
            Rotating re-seals the private key under a new passphrase. The old
            passphrase must be correct; a lost passphrase is unrecoverable.
            {!sealed && " Rotation does not change the in-memory unsealed key."}
          </div>
          <div className="form-grid">
            <Field label="Current passphrase">
              <input
                className="input"
                type="password"
                value={oldP}
                onChange={(e) => setOldP(e.target.value)}
              />
            </Field>
            <Field label="New passphrase">
              <input
                className="input"
                type="password"
                value={newP}
                onChange={(e) => setNewP(e.target.value)}
              />
            </Field>
          </div>
          {rotate.error && (
            <div className="alert danger" style={{ marginTop: 12 }}>
              {rotate.error.message}
            </div>
          )}
          <div className="actions" style={{ marginTop: 14 }}>
            <Button
              variant="primary"
              disabled={!oldP || !newP}
              loading={rotate.loading}
              onClick={rotate.run}
            >
              Rotate passphrase
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

// ---- Matricule template editor ----

const CHECK_SCHEMES = ["none", "luhn", "mod97"] as const;
type CheckScheme = (typeof CHECK_SCHEMES)[number];

function MatriculeTab({ notify }: { notify: (m: string) => void }) {
  const core = useCore();
  const { can } = useSession();
  const manage = can("settings.manage");

  const [rule, setRule] = useState("");
  const [scheme, setScheme] = useState<CheckScheme>("none");
  const [format, setFormat] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Load all three settings on mount
  useEffect(() => {
    let alive = true;
    Promise.all([
      core.getSetting({ key: MATRIC_RULE_KEY }),
      core.getSetting({ key: MATRIC_SCHEME_KEY }),
      core.getSetting({ key: MATRIC_FORMAT_KEY }),
    ]).then(([r, s, f]) => {
      if (!alive) return;
      setRule(typeof r === "string" ? r : "");
      setScheme(
        typeof s === "string" &&
          (CHECK_SCHEMES as readonly string[]).includes(s)
          ? (s as CheckScheme)
          : "none",
      );
      setFormat(typeof f === "string" ? f : "");
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useAction(
    () =>
      Promise.all([
        core.setSetting({ key: MATRIC_RULE_KEY, value: rule }),
        core.setSetting({ key: MATRIC_SCHEME_KEY, value: scheme }),
        core.setSetting({ key: MATRIC_FORMAT_KEY, value: format }),
      ]),
    {
      onSuccess: () => notify("Matricule settings saved"),
    },
  );

  // Live sample: use the pure domain function with representative token values
  const liveSample = (() => {
    try {
      return expandMatricule(rule, {
        institutionCode: "UB",
        faculty: "SCI",
        dept: "CS",
        year: new Date().getFullYear(),
        seq: 1,
        checkScheme: scheme as "none" | "luhn" | "mod97",
      });
    } catch {
      return "";
    }
  })();

  if (!loaded)
    return (
      <Card>
        <div className="muted" style={{ padding: 16 }}>
          Loading…
        </div>
      </Card>
    );

  return (
    <Card title="Matricule template">
      <div className="form-grid">
        <Field label="Rule">
          <input
            className="input mono"
            aria-label="Rule"
            value={rule}
            disabled={!manage}
            placeholder="{fac}/{year}/{seq:0000}"
            onChange={(e) => setRule(e.target.value)}
          />
        </Field>
        <Field label="Check scheme">
          <select
            className="select"
            aria-label="Check scheme"
            value={scheme}
            disabled={!manage}
            onChange={(e) => setScheme(e.target.value as CheckScheme)}
          >
            {CHECK_SCHEMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Format">
          <input
            className="input mono"
            aria-label="Format"
            value={format}
            disabled={!manage}
            placeholder="upper"
            onChange={(e) => setFormat(e.target.value)}
          />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Live sample:{" "}
        </span>
        <output aria-label="Live sample" className="mono">
          {liveSample || "—"}
        </output>
      </div>
      {save.error && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          {save.error.message}
        </div>
      )}
      {manage && (
        <div className="actions" style={{ marginTop: 14 }}>
          <Button variant="primary" loading={save.loading} onClick={save.run}>
            Save matricule settings
          </Button>
        </div>
      )}
    </Card>
  );
}

// --- small shared bits ---

function ListState({
  loading,
  error,
  empty,
  emptyTitle,
  children,
}: {
  loading: boolean;
  error?: string;
  empty: boolean;
  emptyTitle: string;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="muted" style={{ padding: 16 }}>
        Loading…
      </div>
    );
  if (error) return <div className="alert danger">{error}</div>;
  if (empty) return <EmptyState title={emptyTitle} />;
  return <>{children}</>;
}

interface Band {
  minMark: number;
  maxMark: number;
  grade: string;
  gradePoint: number;
  isPass: boolean;
}
function BandsTable({ bands }: { bands: string }) {
  let parsed: Band[] = [];
  try {
    parsed = JSON.parse(bands) as Band[];
  } catch {
    return <div className="alert danger">Corrupt bands JSON.</div>;
  }
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Grade</th>
          <th>Range</th>
          <th>Points</th>
          <th>Pass</th>
        </tr>
      </thead>
      <tbody>
        {parsed.map((b) => (
          <tr key={b.grade}>
            <td className="mono strong">{b.grade}</td>
            <td className="mono">
              {b.minMark}–{b.maxMark}
            </td>
            <td className="mono">{b.gradePoint}</td>
            <td>{b.isPass ? "Yes" : "No"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Component {
  key: string;
  label: string;
  weight: number;
  maxScore: number;
}
function ComponentsTable({ components }: { components: string }) {
  let parsed: Component[] = [];
  try {
    parsed = JSON.parse(components) as Component[];
  } catch {
    return <div className="alert danger">Corrupt components JSON.</div>;
  }
  const total = parsed.reduce((s, c) => s + c.weight, 0);
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Component</th>
          <th>Key</th>
          <th>Weight</th>
          <th>Max</th>
        </tr>
      </thead>
      <tbody>
        {parsed.map((c) => (
          <tr key={c.key}>
            <td>{c.label}</td>
            <td className="mono">{c.key}</td>
            <td className="mono">{c.weight}</td>
            <td className="mono">{c.maxScore}</td>
          </tr>
        ))}
        <tr>
          <td colSpan={2} className="muted">
            Total weight
          </td>
          <td className={`mono strong ${total === 100 ? "" : "weight-bad"}`}>
            {total}
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}
