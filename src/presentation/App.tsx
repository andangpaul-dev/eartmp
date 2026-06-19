/**
 * App root — auth gate + routing. No session → Login. With a session → the
 * AppShell with the selected screen. Locking signs out (clears the session) and
 * returns to Login.
 */
import { useEffect, useState } from "react";
import { useCore, useSession } from "./runtime/CoreProvider";
import { KeyProvider } from "./runtime/KeyProvider";
import { AppShell, type Route } from "./components/AppShell";
import { UnlockScreen } from "./screens/UnlockScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { StudentsScreen } from "./screens/StudentsScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { ImportStudentsScreen } from "./screens/ImportStudentsScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TranscriptsScreen } from "./screens/TranscriptsScreen";
import { RecordsScreen } from "./screens/RecordsScreen";
import { GraduationScreen } from "./screens/GraduationScreen";
import { AuditScreen } from "./screens/AuditScreen";
import { ConfigurationScreen } from "./screens/ConfigurationScreen";
import { StructureScreen } from "./screens/StructureScreen";
import { InstitutionsScreen } from "./screens/InstitutionsScreen";
import { SecurityScreen } from "./screens/SecurityScreen";
import { UsersScreen } from "./screens/UsersScreen";
import { RolesScreen } from "./screens/RolesScreen";
import { LegalScreen } from "./screens/LegalScreen";
import { DiagnosticsScreen } from "./screens/DiagnosticsScreen";
import { Placeholder } from "./screens/Placeholder";

const SCREEN_NAMES: Record<Route, string> = {
  dashboard: "Dashboard",
  students: "Students",
  results: "Results",
  import: "Import results",
  importStudents: "Import students",
  summary: "Academic summary",
  transcripts: "Transcripts",
  records: "Records",
  graduation: "Graduation",
  institutions: "Institutions",
  structure: "Academic structure",
  config: "Configuration",
  security: "Security & keys",
  users: "Users",
  roles: "Roles & permissions",
  audit: "Audit log",
  legal: "Legal",
  diagnostics: "Diagnostics",
};

export function App() {
  const core = useCore();
  const { session, setSession } = useSession();
  const [route, setRoute] = useState<Route>("dashboard");
  // null = still checking lock state; true = encrypted DB awaiting unlock.
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    const check = (): void => {
      core
        .lockState()
        .then((s) => alive && setLocked(s.locked))
        .catch(() => {
          // Host not listening yet (first-launch provisioning can take ~20s on
          // the encrypted DB) — keep polling until it responds.
          if (alive && tries++ < 60) setTimeout(check, 1000);
        });
    };
    check();
    return () => {
      alive = false;
    };
  }, [core]);

  if (locked === null) return <div className="splash">Starting…</div>;
  if (locked) return <UnlockScreen onUnlocked={() => setLocked(false)} />;
  if (!session) return <LoginScreen />;

  const screen =
    route === "dashboard" ? (
      <DashboardScreen />
    ) : route === "students" ? (
      <StudentsScreen />
    ) : route === "results" ? (
      <ResultsScreen />
    ) : route === "import" ? (
      <ImportScreen />
    ) : route === "importStudents" ? (
      <ImportStudentsScreen />
    ) : route === "summary" ? (
      <SummaryScreen />
    ) : route === "transcripts" ? (
      <TranscriptsScreen />
    ) : route === "records" ? (
      <RecordsScreen />
    ) : route === "graduation" ? (
      <GraduationScreen />
    ) : route === "audit" ? (
      <AuditScreen />
    ) : route === "config" ? (
      <ConfigurationScreen />
    ) : route === "institutions" ? (
      <InstitutionsScreen />
    ) : route === "structure" ? (
      <StructureScreen />
    ) : route === "security" ? (
      <SecurityScreen />
    ) : route === "users" ? (
      <UsersScreen />
    ) : route === "roles" ? (
      <RolesScreen />
    ) : route === "legal" ? (
      <LegalScreen />
    ) : route === "diagnostics" ? (
      <DiagnosticsScreen />
    ) : (
      <Placeholder name={SCREEN_NAMES[route]} />
    );

  return (
    <KeyProvider>
      <AppShell
        route={route}
        setRoute={setRoute}
        onLock={async () => {
          await core.logout();
          setSession(null);
          setRoute("dashboard");
        }}
      >
        {screen}
      </AppShell>
    </KeyProvider>
  );
}
