/**
 * Login — navy gradient brand panel + the sign-in form. Shows the "change the
 * default password" banner. On success the host returns a SessionView the app
 * gates on. Generic credentials error (no user enumeration).
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAction } from "../runtime/hooks";
import { Button, Field } from "../components/ui";

export function LoginScreen() {
  const core = useCore();
  const { setSession } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = useAction(() => core.login({ username, password }), {
    onSuccess: (r) => setSession(r.session),
  });

  return (
    <div className="login">
      <div className="left">
        <h1>EARTMP</h1>
        <p>
          Academic Records &amp; Transcript Management — the registry's offline
          system of record. Digitally-signed, tamper-evident transcripts on
          local SQLite.
        </p>
      </div>
      <div className="right">
        <div className="panel">
          <h2>Sign in</h2>
          <div className="sub">Use your registry account.</div>

          <div className="alert warn" style={{ marginBottom: 18 }}>
            First login? The default admin password must be changed immediately.
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit.run();
            }}
          >
            <Field label="Username">
              <input
                className="input"
                value={username}
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {submit.error && (
              <div className="alert danger" style={{ marginBottom: 14 }}>
                {submit.error.message}
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={submit.loading}
              style={{ width: "100%", justifyContent: "center" }}
            >
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
