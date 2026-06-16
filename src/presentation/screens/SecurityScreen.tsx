/**
 * Security — admin management of the transcript-signing key. Shows whether a key
 * is provisioned and whether it's unsealed this session, lets the admin CREATE a
 * key (or REPLACE one — which invalidates every previously issued transcript),
 * and rotate the operator passphrase. Gated security.manage. The raw key and
 * passphrases never leave the host; this screen only sends passphrases to seal/
 * open. A lost passphrase is unrecoverable.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { Card, Button, Field, Badge, Toast, Icon } from "../components/ui";

export function SecurityScreen() {
  const core = useCore();
  const status = useAsync(() => core.keyStatus({}), []);
  const provisioned = status.data?.provisioned ?? false;
  const sealed = status.data?.sealed ?? true;
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  // Provision / replace
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const provision = useAction(
    () =>
      core.provisionSigningKey({
        passphrase: pass,
        ...(provisioned ? { replaceExisting: true } : {}),
      }),
    {
      onSuccess: () => {
        notify(
          provisioned
            ? "Signing key replaced. Re-unseal it before issuing transcripts."
            : "Signing key created. Unseal it before issuing transcripts.",
        );
        setPass("");
        setConfirm("");
        setAck(false);
        status.reload();
      },
    },
  );
  const provisionReady =
    pass.length >= 8 && pass === confirm && (!provisioned || ack);

  // Rotate passphrase
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newConfirm, setNewConfirm] = useState("");
  const rotate = useAction(
    () =>
      core.changeKeyPassphrase({
        oldPassphrase: oldPass,
        newPassphrase: newPass,
      }),
    {
      onSuccess: () => {
        notify("Passphrase changed.");
        setOldPass("");
        setNewPass("");
        setNewConfirm("");
      },
    },
  );
  const rotateReady =
    oldPass.length > 0 && newPass.length >= 8 && newPass === newConfirm;

  return (
    <div className="stack">
      <Card title="Transcript signing key">
        {status.loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="row" style={{ gap: 10 }}>
            {provisioned ? (
              <Badge tone="success">
                <Icon name="key" size={13} /> Provisioned
              </Badge>
            ) : (
              <Badge tone="danger">Not provisioned</Badge>
            )}
            <Badge tone={sealed ? "warn" : "info"}>
              {sealed ? "Sealed" : "Unsealed this session"}
            </Badge>
          </div>
        )}
        <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          The private key is sealed at rest and unsealed in memory for the
          session from the Transcripts screen. A lost passphrase is
          unrecoverable.
        </div>
      </Card>

      <Card title={provisioned ? "Replace signing key" : "Create signing key"}>
        {provisioned && (
          <div className="alert warn" style={{ marginBottom: 12 }}>
            Replacing the key invalidates the signature on every transcript
            already issued — they will verify as “key mismatch”. Only do this if
            the current key is compromised or lost.
          </div>
        )}
        <div className="form-grid">
          <Field label="Passphrase (min 8 chars)">
            <input
              className="input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </Field>
          <Field label="Confirm passphrase">
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </div>
        {provisioned && (
          <label className="row" style={{ gap: 8, marginTop: 4 }}>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I understand this invalidates previously issued transcripts.
            </span>
          </label>
        )}
        {provision.error && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            {provision.error.message}
          </div>
        )}
        <div className="actions">
          <Button
            variant={provisioned ? "danger" : "primary"}
            disabled={!provisionReady}
            loading={provision.loading}
            onClick={provision.run}
          >
            {provisioned ? "Replace key" : "Create key"}
          </Button>
        </div>
      </Card>

      {provisioned && (
        <Card title="Rotate passphrase">
          <div className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
            Re-seals the same key under a new passphrase. Existing transcripts
            stay valid.
          </div>
          <div className="form-grid">
            <Field label="Current passphrase">
              <input
                className="input"
                type="password"
                value={oldPass}
                onChange={(e) => setOldPass(e.target.value)}
              />
            </Field>
            <Field label="New passphrase (min 8)">
              <input
                className="input"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
            </Field>
            <Field label="Confirm new passphrase">
              <input
                className="input"
                type="password"
                value={newConfirm}
                onChange={(e) => setNewConfirm(e.target.value)}
              />
            </Field>
          </div>
          {rotate.error && (
            <div className="alert danger" style={{ marginTop: 12 }}>
              {rotate.error.message}
            </div>
          )}
          <div className="actions">
            <Button
              variant="primary"
              disabled={!rotateReady}
              loading={rotate.loading}
              onClick={rotate.run}
            >
              Change passphrase
            </Button>
          </div>
        </Card>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
