/**
 * Configuration — institution profile, grading configuration (grade scales &
 * assessment structures, runtime-configured, never hardcoded), graduation
 * requirements, and signing-key security. Reads are gated by `*.read`; writes
 * by `*.manage`. All values come from and go to the core.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { useAsync, useAction } from "../runtime/hooks";
import {
  Button,
  Card,
  Badge,
  Field,
  Toast,
  EmptyState,
} from "../components/ui";
import type {
  Institution,
  StoredGradeScale,
  StoredAssessmentConfig,
  GraduationRequirements,
} from "../runtime/contract";

const CALENDAR_TYPES = ["SEMESTER", "TRIMESTER", "QUARTER"] as const;
const GRAD_KEY = "graduation.requirements";
const MATRIC_RULE_KEY = "student.matriculeRule";
const MATRIC_SCHEME_KEY = "student.matriculeCheckScheme";
const MATRIC_FORMAT_KEY = "student.matriculeFormat";

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

  const setScaleDefault = async (s: StoredGradeScale) => {
    try {
      await core.setDefaultGradeScale({ id: s.id });
      scales.reload();
      notify(`"${s.name}" is now the default grade scale`);
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

  return (
    <>
      <Card title="Grade scales">
        <ListState
          loading={scales.loading}
          error={scales.error?.message}
          empty={(scales.data?.length ?? 0) === 0}
          emptyTitle="No grade scales configured"
        >
          <div className="stack" style={{ gap: 10 }}>
            {scales.data?.map((s) => (
              <ConfigRow
                key={s.id}
                name={s.name}
                isDefault={s.isDefault}
                detail={<BandsTable bands={s.bands} />}
                canManage={manage}
                onSetDefault={() => setScaleDefault(s)}
              />
            ))}
          </div>
        </ListState>
      </Card>

      <Card title="Assessment structures">
        <ListState
          loading={configs.loading}
          error={configs.error?.message}
          empty={(configs.data?.length ?? 0) === 0}
          emptyTitle="No assessment structures configured"
        >
          <div className="stack" style={{ gap: 10 }}>
            {configs.data?.map((c) => (
              <ConfigRow
                key={c.id}
                name={c.name}
                isDefault={c.isDefault}
                detail={<ComponentsTable components={c.components} />}
                canManage={manage}
                onSetDefault={() => setConfigDefault(c)}
              />
            ))}
          </div>
        </ListState>
      </Card>
    </>
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

  // Live sample: substitute the rule tokens with placeholder values
  const liveSample = rule
    .replace(/\{fac\}/gi, "SCI")
    .replace(/\{dept\}/gi, "CS")
    .replace(/\{year\}/gi, "2024")
    .replace(/\{seq:0+\}/gi, (m) => {
      const zeros = m.replace(/[^0]/g, "");
      return "1".padStart(zeros.length, "0");
    })
    .replace(/\{seq\}/gi, "1");

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

function ConfigRow({
  name,
  isDefault,
  detail,
  canManage,
  onSetDefault,
}: {
  name: string;
  isDefault: boolean;
  detail: ReactNode;
  canManage: boolean;
  onSetDefault: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="config-row">
      <div className="spread">
        <div className="row" style={{ gap: 10 }}>
          <strong>{name}</strong>
          {isDefault && <Badge tone="success">Default</Badge>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "View"}
          </Button>
          {canManage && !isDefault && (
            <Button variant="ghost" onClick={onSetDefault}>
              Set default
            </Button>
          )}
        </div>
      </div>
      {open && <div style={{ marginTop: 10 }}>{detail}</div>}
    </div>
  );
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
