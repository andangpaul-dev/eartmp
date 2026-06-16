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
import { SummaryScreen } from "./screens/SummaryScreen";
import { TranscriptsScreen } from "./screens/TranscriptsScreen";
import { RecordsScreen } from "./screens/RecordsScreen";
import { GraduationScreen } from "./screens/GraduationScreen";
import { AuditScreen } from "./screens/AuditScreen";
import { ConfigurationScreen } from "./screens/ConfigurationScreen";
import { UsersScreen } from "./screens/UsersScreen";
import { Placeholder } from "./screens/Placeholder";

const SCREEN_NAMES: Record<Route, string> = {
  dashboard: "Dashboard",
  students: "Students",
  results: "Results",
  import: "Import results",
  summary: "Academic summary",
  transcripts: "Transcripts",
  records: "Records",
  graduation: "Graduation",
  config: "Configuration",
  users: "Users & roles",
  audit: "Audit log",
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
    ) : route === "users" ? (
      <UsersScreen />
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
