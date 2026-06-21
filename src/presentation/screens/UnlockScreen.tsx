/**
 * Unlock — shown when the database is encrypted at rest and locked. The operator
 * passphrase derives the DB key (never stored); a wrong passphrase can't decrypt
 * the file. On success the host opens + provisions the DB and the app proceeds
 * to sign-in.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAction } from "../runtime/hooks";
import { Button, Field, Icon } from "../components/ui";
import {
  isDatabaseLockedError,
  DatabaseLockedHelp,
} from "../components/DatabaseLockedHelp";

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const core = useCore();
  const [passphrase, setPassphrase] = useState("");

  const submit = useAction(() => core.unlock({ passphrase }), {
    onSuccess: (r) => {
      if (!r.locked) onUnlocked();
    },
  });

  return (
    <div className="login">
      <div className="left">
        <h1>EARTMP</h1>
        <p>
          The records database is encrypted at rest. Enter the institution
          passphrase to unlock it for this session.
        </p>
      </div>
      <div className="right">
        <div className="panel">
          <h2>
            <Icon name="key" size={18} /> Unlock database
          </h2>
          <div className="sub">
            The key is derived from this passphrase and never stored. A lost
            passphrase is unrecoverable.
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit.run();
            }}
          >
            <Field label="Institution passphrase">
              <input
                className="input"
                type="password"
                autoFocus
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Field>
            {submit.error &&
              (isDatabaseLockedError(submit.error.message) ? (
                <DatabaseLockedHelp onRetry={() => submit.run()} />
              ) : (
                <div className="alert danger" style={{ marginBottom: 14 }}>
                  {submit.error.message}
                </div>
              ))}
            <Button
              type="submit"
              variant="primary"
              loading={submit.loading}
              disabled={!passphrase}
              style={{ width: "100%", justifyContent: "center" }}
            >
              Unlock
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
