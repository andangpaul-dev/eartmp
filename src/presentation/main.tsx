/**
 * Webview entry. Builds the IPC client (talks to the Node host over /api),
 * hydrates the session via currentUser(), and mounts React. Pure browser code.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoreProvider } from "./runtime/CoreProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ipcClient } from "./runtime/ipcClient";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element.");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <CoreProvider client={ipcClient}>
        <App />
      </CoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
