/**
 * App root — auth gate + routing. No session → Login. With a session → the
 * AppShell with the selected screen. Locking signs out (clears the session) and
 * returns to Login.
 */
import { useState } from "react";
import { useCore, useSession } from "./runtime/CoreProvider";
import { KeyProvider } from "./runtime/KeyProvider";
import { AppShell, type Route } from "./components/AppShell";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { StudentsScreen } from "./screens/StudentsScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TranscriptsScreen } from "./screens/TranscriptsScreen";
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
  graduation: "Graduation",
  config: "Configuration",
  users: "Users & roles",
  audit: "Audit log",
};

export function App() {
  const core = useCore();
  const { session, setSession } = useSession();
  const [route, setRoute] = useState<Route>("dashboard");

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
