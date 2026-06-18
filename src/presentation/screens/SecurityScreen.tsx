/**
 * Security — admin management of the transcript-signing key. Shows whether a key
 * is provisioned and whether it's unsealed this session, lets the admin CREATE a
 * key (or REPLACE one — which invalidates every previously issued transcript),
 * and rotate the operator passphrase. Gated security.manage. The raw key and
 * passphrases never leave the host; this screen only sends passphrases to seal/
 * open. A lost passphrase is unrecoverable.
 *
 * Phase F: a scope selector chooses the DEFAULT (global) key or an institution's
 * DEDICATED key. An institution with no dedicated key signs with the default
 * key; provisioning one here makes it sign with its own. The same selector also
 * UNSEALS/SEALS the chosen scope's key for this session, so a global admin can
 * ready any institution's dedicated key for issuing transcripts. Single-institution
 * deployments simply leave the scope on “Default”.
 */
import { useState } from "react";
import { useCore } from "../runtime/CoreProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { Card, Button, Field, Badge, Toast, Icon } from "../components/ui";

export function SecurityScreen() {
  const core = useCore();
  // Scope: "" = the default/global key; otherwise an institution's dedicated key.
  const [scopeId, setScopeId] = useState("");
  const institutionId = scopeId || undefined;
  // Best-effort: the operator may lack institution.manage — then only the
  // default key is manageable and the selector stays hidden.
  const insts = useAsync(() => core.listInstitutions({}), []);
  const institutions = insts.data ?? [];

  const status = useAsync(
    () => core.keyStatus(institutionId ? { institutionId } : {}),
    [scopeId],
  );
  // For a specific institution, "provisioned" means it owns a DEDICATED key.
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
        ...(institutionId ? { institutionId } : {}),
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
        ...(institutionId ? { institutionId } : {}),
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

  // Unseal / seal the selected scope's key for this session (Phase F). The host
  // holds the unsealed signer in memory per institution; this lets a global admin
  // ready a specific institution's dedicated key without a scoped login.
  const [unsealPass, setUnsealPass] = useState("");
  const unsealAct = useAction(
    () =>
      core.unsealKey({
        passphrase: unsealPass,
        ...(institutionId ? { institutionId } : {}),
      }),
    {
      onSuccess: () => {
        notify(
          institutionId
            ? "Institution key unsealed for this session."
            : "Default key unsealed for this session.",
        );
        setUnsealPass("");
        status.reload();
      },
    },
  );
  const sealAct = useAction(
    () => core.sealKey(institutionId ? { institutionId } : {}),
    {
      onSuccess: () => {
        notify("Key sealed.");
        status.reload();
      },
    },
  );

  return (
    <div className="stack">
      <Card title="Transcript signing key">
        {institutions.length > 0 && (
          <Field label="Key scope">
            <select
              className="input"
              aria-label="Signing key scope"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">Default (global) key</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — dedicated key
                </option>
              ))}
            </select>
          </Field>
        )}
        {status.loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            {provisioned ? (
              <Badge tone="success">
                <Icon name="key" size={13} /> Provisioned
              </Badge>
            ) : (
              <Badge tone={institutionId ? "info" : "danger"}>
                {institutionId ? "Uses default key" : "Not provisioned"}
              </Badge>
            )}
            {provisioned && (
              <Badge tone={sealed ? "warn" : "info"}>
                {sealed ? "Sealed" : "Unsealed this session"}
              </Badge>
            )}
          </div>
        )}
        <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          {institutionId
            ? "A dedicated key makes this institution sign its own transcripts. Without one it signs with the default key."
            : "The private key is sealed at rest and unsealed in memory for the session from the Transcripts screen. A lost passphrase is unrecoverable."}
        </div>
      </Card>

      {provisioned && (
        <Card title="Unseal for this session">
          <div className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
            {sealed
              ? institutionId
                ? "Unseal this institution's key to issue its transcripts this session. It stays in memory only until you seal it or close the app."
                : "Unseal the default key to issue transcripts this session."
              : "Unsealed for this session. Seal it to require the passphrase again."}
          </div>
          {sealed ? (
            <>
              <div className="form-grid">
                <Field label="Passphrase">
                  <input
                    className="input"
                    type="password"
                    aria-label="Signing key passphrase"
                    value={unsealPass}
                    onChange={(e) => setUnsealPass(e.target.value)}
                  />
                </Field>
              </div>
              {unsealAct.error && (
                <div className="alert danger" style={{ marginTop: 12 }}>
                  {unsealAct.error.message}
                </div>
              )}
              <div className="actions">
                <Button
                  variant="primary"
                  disabled={unsealPass.length === 0}
                  loading={unsealAct.loading}
                  onClick={unsealAct.run}
                >
                  {institutionId ? "Unseal institution key" : "Unseal"}
                </Button>
              </div>
            </>
          ) : (
            <div className="actions">
              <Button
                variant="default"
                loading={sealAct.loading}
                onClick={sealAct.run}
              >
                Seal
              </Button>
            </div>
          )}
        </Card>
      )}

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
