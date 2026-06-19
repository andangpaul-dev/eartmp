/**
 * ErrorBoundary — a top-level safety net so a render error shows a friendly,
 * recoverable screen instead of a white page. It reassures the operator their
 * data is safe (it lives in the local database, untouched by a UI crash), offers
 * a one-click "Copy diagnostics" for support, and a Reload. The error is also
 * logged to the host log via console.error.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the rotating host log (the sidecar mirrors webview console).
    console.error("[ui] render error:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private diagnostics(): string {
    const e = this.state.error;
    return [
      `EARTMP ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "?"}`,
      `When: ${new Date().toISOString()}`,
      `URL: ${location.href}`,
      `Agent: ${navigator.userAgent}`,
      "",
      `Error: ${e?.name ?? "Error"}: ${e?.message ?? ""}`,
      (e?.stack ?? "").trim(),
      "",
      "Component stack:",
      this.state.componentStack.trim(),
    ].join("\n");
  }

  private copy = (): void => {
    void navigator.clipboard?.writeText(this.diagnostics()).catch(() => {});
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="errscreen" role="alert">
        <div className="errcard">
          <h2>Something went wrong</h2>
          <p className="muted">
            The app hit an unexpected error and stopped rendering this view.
            Your data is safe — it is stored in the local database and was not
            affected. Reload to continue, and send the diagnostics to support if
            it keeps happening.
          </p>
          <pre className="errdetail">{this.diagnostics()}</pre>
          <div className="erractions">
            <button type="button" className="btn default" onClick={this.copy}>
              Copy diagnostics
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
