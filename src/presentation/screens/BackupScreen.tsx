/**
 * Backup & restore — an encrypted, verify-first data safety wizard.
 *
 * - CREATE: export the whole dataset encrypted under a passphrase and download it
 *   as a portable `.json` backup file. The passphrase is never stored; a lost
 *   passphrase makes the backup unrecoverable.
 * - VERIFY: a NON-DESTRUCTIVE "test restore" — decrypt + checksum-check a backup
 *   to confirm it's genuinely restorable, without touching live data.
 * - RESTORE: verify-first then atomically replace all data (destructive; behind a
 *   typed confirmation). A reload follows so the app re-hydrates.
 *
 * Gated: create/verify need backup.create, restore needs backup.restore.
 */
import { useState } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useAction } from "../runtime/hooks";
import {
  Card,
  Button,
  Field,
  Modal,
  Toast,
  Badge,
  Icon,
} from "../components/ui";
import type { BackupEnvelope } from "../runtime/contract";

function downloadBackup(env: BackupEnvelope): void {
  const blob = new Blob([JSON.stringify(env, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `eartmp-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BackupScreen() {
  const core = useCore();
  const { can } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  // ---- Create ----
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const create = useAction(() => core.createBackup({ passphrase: pass }), {
    onSuccess: (env) => {
      downloadBackup(env);
      setPass("");
      setConfirm("");
      notify("Backup created and downloaded.");
    },
  });
  const createReady = pass.length >= 8 && pass === confirm;

  // ---- Verify / restore ----
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [fileName, setFileName] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [result, setResult] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restored, setRestored] = useState(false);

  const loadFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const env = JSON.parse(String(reader.result)) as BackupEnvelope;
        if (!env?.manifest || !env?.ciphertext) throw new Error("bad shape");
        setEnvelope(env);
        setFileName(file.name);
        setResult(null);
      } catch {
        setEnvelope(null);
        setFileName("");
        setResult({ tone: "danger", text: "Not a valid EARTMP backup file." });
      }
    };
    reader.readAsText(file);
  };

  const verify = useAction(
    () => core.verifyBackup({ envelope: envelope!, passphrase: restorePass }),
    {
      onSuccess: (r) =>
        setResult({
          tone: "success",
          text: `Restorable — ${r.tables} tables, ${r.rows} rows (created ${new Date(
            r.createdAt,
          ).toLocaleString()}).`,
        }),
      onError: (e) => setResult({ tone: "danger", text: e.message }),
    },
  );
  const restore = useAction(
    () => core.restoreBackup({ envelope: envelope!, passphrase: restorePass }),
    {
      onSuccess: (r) => {
        setConfirmRestore(false);
        setRestored(true);
        setResult({
          tone: "success",
          text: `Restored ${r.rows} rows across ${r.tables} tables.`,
        });
      },
      onError: (e) => {
        setConfirmRestore(false);
        setResult({ tone: "danger", text: e.message });
      },
    },
  );
  const ready = !!envelope && restorePass.length > 0;

  return (
    <div className="stack">
      {can("backup.create") && (
        <Card title="Create a backup">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Exports the entire dataset, encrypted under a passphrase, as a
            downloadable file. The passphrase is never stored — keep it safe; a
            lost passphrase makes the backup unrecoverable.
          </div>
          <div className="form-grid">
            <Field label="Backup passphrase (min 8 chars)">
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
          {create.error && (
            <div className="alert danger" style={{ marginTop: 12 }}>
              {create.error.message}
            </div>
          )}
          <div className="actions">
            <Button
              variant="primary"
              disabled={!createReady}
              loading={create.loading}
              onClick={create.run}
            >
              <Icon name="download" size={14} /> Create &amp; download backup
            </Button>
          </div>
        </Card>
      )}

      <Card title="Verify or restore a backup">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Load a backup file, then <strong>verify</strong> it (safe, no changes)
          or <strong>restore</strong> it (replaces all current data).
        </div>
        <div className="form-grid">
          <Field label="Backup file">
            <input
              className="input"
              type="file"
              accept="application/json,.json"
              aria-label="Backup file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
              }}
            />
          </Field>
          <Field label="Backup passphrase">
            <input
              className="input"
              type="password"
              value={restorePass}
              onChange={(e) => setRestorePass(e.target.value)}
            />
          </Field>
        </div>
        {fileName && (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Loaded: {fileName}
          </div>
        )}
        {result && (
          <div style={{ marginTop: 10 }}>
            <Badge tone={result.tone}>{result.text}</Badge>
          </div>
        )}
        <div className="actions">
          <Button
            disabled={!ready}
            loading={verify.loading}
            onClick={verify.run}
          >
            <Icon name="check" size={14} /> Verify (safe)
          </Button>
          {can("backup.restore") && (
            <Button
              variant="danger"
              disabled={!ready}
              onClick={() => setConfirmRestore(true)}
            >
              Restore (replace all data)
            </Button>
          )}
        </div>
        {restored && (
          <div className="actions">
            <Button variant="primary" onClick={() => location.reload()}>
              Reload app
            </Button>
          </div>
        )}
      </Card>

      {confirmRestore && (
        <Modal
          title="Restore this backup?"
          subtitle="This replaces ALL current data with the backup's contents."
          onClose={() => setConfirmRestore(false)}
        >
          <div className="alert danger">
            Restoring overwrites every record in the database with the contents
            of this backup. The current data cannot be recovered afterwards
            unless you backed it up first. The backup is verified before any
            write — a wrong passphrase or tampered file aborts with no changes.
          </div>
          <div className="actions">
            <Button onClick={() => setConfirmRestore(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={restore.loading}
              onClick={restore.run}
            >
              Verify &amp; restore
            </Button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
