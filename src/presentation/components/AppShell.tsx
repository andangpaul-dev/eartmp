/**
 * AppShell — the navy sidebar (permission-gated nav, disabled items with a
 * reason tooltip + lock icon) and the white topbar (title, search, signing-key
 * chip, user, lock). Nav reflects what the host granted; it never asserts
 * privileges. Screens render in the content slot.
 */
import type { ReactNode } from "react";
import { useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { Icon } from "./ui";

export type Route =
  | "dashboard"
  | "students"
  | "results"
  | "import"
  | "importStudents"
  | "summary"
  | "transcripts"
  | "records"
  | "graduation"
  | "structure"
  | "config"
  | "users"
  | "audit";

interface NavDef {
  key: Route;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  perm?: string;
  group: string;
}

const NAV: NavDef[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", group: "" },
  {
    key: "students",
    label: "Students",
    icon: "students",
    perm: "students.read",
    group: "Records",
  },
  {
    key: "results",
    label: "Results",
    icon: "results",
    perm: "results.process",
    group: "Records",
  },
  {
    key: "import",
    label: "Import results",
    icon: "results",
    perm: "results.import",
    group: "Records",
  },
  {
    key: "importStudents",
    label: "Import students",
    icon: "students",
    perm: "students.create",
    group: "Records",
  },
  {
    key: "summary",
    label: "Academic summary",
    icon: "results",
    perm: "results.read",
    group: "Academic",
  },
  {
    key: "transcripts",
    label: "Transcripts",
    icon: "transcript",
    perm: "transcripts.read",
    group: "Academic",
  },
  {
    key: "records",
    label: "Records",
    icon: "shield",
    perm: "transcripts.read",
    group: "Academic",
  },
  {
    key: "graduation",
    label: "Graduation",
    icon: "graduation",
    perm: "graduation.read",
    group: "Academic",
  },
  {
    key: "structure",
    label: "Structure",
    icon: "dashboard",
    perm: "structure.read",
    group: "Administration",
  },
  {
    key: "config",
    label: "Configuration",
    icon: "config",
    perm: "config.read",
    group: "Administration",
  },
  {
    key: "users",
    label: "Users & roles",
    icon: "admin",
    perm: "users.read",
    group: "Administration",
  },
  {
    key: "audit",
    label: "Audit log",
    icon: "audit",
    perm: "audit.read",
    group: "Administration",
  },
];

const TITLES: Record<Route, { t: string; s: string }> = {
  dashboard: { t: "Dashboard", s: "Registry overview" },
  students: { t: "Students", s: "Records & admission" },
  results: { t: "Results", s: "Entry & processing" },
  import: { t: "Import results", s: "Spreadsheet import" },
  importStudents: { t: "Import students", s: "Bulk upload by placement" },
  summary: { t: "Academic summary", s: "Semester GPA & cumulative CGPA" },
  transcripts: { t: "Transcripts", s: "Generate, verify & export" },
  records: { t: "Records", s: "All treated transcripts" },
  graduation: { t: "Graduation", s: "Eligibility & clearance" },
  structure: { t: "Academic structure", s: "Faculties, departments & courses" },
  config: { t: "Configuration", s: "Grading, assessment & institution" },
  users: { t: "Users & roles", s: "Access control" },
  audit: { t: "Audit log", s: "Append-only, tamper-evident" },
};

export function AppShell({
  route,
  setRoute,
  onLock,
  children,
}: {
  route: Route;
  setRoute: (r: Route) => void;
  onLock: () => void;
  children: ReactNode;
}) {
  const { session, can } = useSession();
  const { sealed } = useKeyState();
  const groups = [...new Set(NAV.map((n) => n.group))];
  const initials = (session?.userId ?? "?").slice(0, 2).toUpperCase();
  const title = TITLES[route];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">E</div>
          <div>EARTMP</div>
        </div>
        {groups.map((g) => (
          <div className="nav-group" key={g || "main"}>
            {g && <div className="hdr">{g}</div>}
            {NAV.filter((n) => n.group === g).map((n) => {
              const allowed = !n.perm || can(n.perm);
              return (
                <button
                  key={n.key}
                  className={`nav-item ${route === n.key ? "active" : ""}`}
                  disabled={!allowed}
                  title={allowed ? n.label : `Requires "${n.perm}"`}
                  onClick={() => allowed && setRoute(n.key)}
                >
                  <Icon name={n.icon} size={17} />
                  <span className="grow">{n.label}</span>
                  {!allowed && (
                    <span className="lock">
                      <Icon name="lock" size={13} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <div className="footer">
          <span className="dot" style={{ background: "var(--success-dot)" }} />
          Offline · local SQLite · v{__APP_VERSION__}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="titles">
            <div className="t">{title.t}</div>
            <div className="s">{title.s}</div>
          </div>
          <div className="grow" />
          <span
            className={`chip ${sealed ? "" : "chip-ok"}`}
            title={
              sealed
                ? "Transcript signing key is sealed at rest"
                : "Transcript signing key is unsealed for this session"
            }
          >
            <Icon name={sealed ? "key" : "shield"} size={13} />{" "}
            {sealed ? "Key sealed" : "Key unsealed"}
          </span>
          <div className="avatar" title={`${session?.role ?? ""}`}>
            {initials}
          </div>
          <button
            className="btn ghost"
            onClick={onLock}
            title="Lock & sign out"
          >
            <Icon name="logout" size={16} />
          </button>
        </header>
        <main className="content">
          <div className="inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
