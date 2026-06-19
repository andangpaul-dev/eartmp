/**
 * Transcripts — generate (DRAFT, snapshot + Ed25519 signature) → verify the
 * signature → approve (DRAFT→APPROVED) → export. An A4 preview renders the
 * snapshot watermarked "DRAFT — NOT VALID"; an OFFICIAL export requires
 * APPROVED/LOCKED. Generating and verifying need the signing key unsealed for
 * this session (a lost passphrase is unrecoverable).
 */
import { useState, useEffect } from "react";
import { useCore, useSession } from "../runtime/CoreProvider";
import { useKeyState } from "../runtime/KeyProvider";
import { useAsync, useAction } from "../runtime/hooks";
import { StudentPicker } from "../components/StudentPicker";
import {
  Button,
  Card,
  Badge,
  Field,
  Modal,
  Toast,
  EmptyState,
  Icon,
  type Tone,
} from "../components/ui";
import type { Student } from "../../domain/entities";
import type {
  StoredTranscript,
  VerifyResult,
  ExportedDoc,
} from "../runtime/contract";

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "warn",
  APPROVED: "info",
  LOCKED: "success",
  REVOKED: "danger",
};

function downloadDoc(doc: ExportedDoc): void {
  const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: doc.contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TranscriptsScreen() {
  const core = useCore();
  const { can } = useSession();
  const { sealed } = useKeyState();
  const [student, setStudent] = useState<Student | null>(null);
  const [unsealOpen, setUnsealOpen] = useState(false);
  const [verifyOf, setVerifyOf] = useState<Record<string, VerifyResult>>({});
  const [preview, setPreview] = useState<{
    number: string;
    url: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  // Revoke the preview blob URL when it changes or the screen unmounts.
  useEffect(() => {
    const url = preview?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview?.url]);

  const list = useAsync(
    () =>
      student
        ? core.listTranscripts({ studentId: student.id })
        : Promise.resolve([]),
    [student?.id],
  );

  const generate = useAction(
    () => core.generateTranscript({ studentId: student!.id }),
    {
      onSuccess: (t) => {
        list.reload();
        notify(`Generated ${t.transcriptNumber} (DRAFT)`);
      },
    },
  );

  const certificate = useAction(
    () => core.generateCertificate({ studentId: student!.id }),
    {
      onSuccess: (t) => {
        list.reload();
        notify(`Generated certificate ${t.transcriptNumber} (DRAFT)`);
      },
    },
  );

  const verify = async (t: StoredTranscript) => {
    try {
      const r = await core.verifyTranscript({ transcriptId: t.id });
      setVerifyOf((m) => ({ ...m, [t.id]: r }));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const approve = async (t: StoredTranscript) => {
    try {
      await core.approveTranscript({ transcriptId: t.id });
      list.reload();
      notify(`${t.transcriptNumber} approved`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Approve failed");
    }
  };

  const lock = async (t: StoredTranscript) => {
    try {
      await core.lockTranscript({ transcriptId: t.id });
      list.reload();
      notify(`${t.transcriptNumber} locked`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Lock failed");
    }
  };

  const revoke = async (t: StoredTranscript) => {
    if (
      !window.confirm(
        `Revoke ${t.transcriptNumber}? It will no longer verify as a valid issue. This is recorded in the audit log.`,
      )
    )
      return;
    try {
      await core.revokeTranscript({ transcriptId: t.id });
      list.reload();
      setVerifyOf((m) => {
        const n = { ...m };
        delete n[t.id];
        return n;
      });
      notify(`${t.transcriptNumber} revoked`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Revoke failed");
    }
  };

  const showPreview = async (t: StoredTranscript) => {
    try {
      const doc = await core.exportTranscript({
        transcriptId: t.id,
        preview: true,
      });
      const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: doc.contentType }),
      );
      setPreview({ number: t.transcriptNumber, url });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Preview failed");
    }
  };

  const exportOfficial = async (t: StoredTranscript) => {
    try {
      downloadDoc(await core.exportTranscript({ transcriptId: t.id }));
      notify(`Exported ${t.transcriptNumber}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <div className="stack">
      <KeyBanner sealed={sealed} onUnseal={() => setUnsealOpen(true)} />

      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
          <StudentPicker value={student} onChange={setStudent} />
          {student && can("transcripts.generate") && (
            <div className="row" style={{ gap: 8 }}>
              <Button
                variant="primary"
                loading={generate.loading}
                disabled={sealed}
                title={sealed ? "Unseal the signing key first" : undefined}
                onClick={generate.run}
              >
                <Icon name="plus" size={15} /> Generate transcript
              </Button>
              <Button
                loading={certificate.loading}
                disabled={sealed}
                title={sealed ? "Unseal the signing key first" : undefined}
                onClick={certificate.run}
              >
                <Icon name="plus" size={15} /> Generate certificate
              </Button>
            </div>
          )}
        </div>
        {(generate.error || certificate.error) && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            {(generate.error || certificate.error)?.message}
          </div>
        )}
      </Card>

      {student && (
        <Card title="Transcripts">
          {list.loading ? (
            <div className="muted" style={{ padding: 16 }}>
              Loading…
            </div>
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="No transcripts yet"
              hint="Generate one to create a signed DRAFT."
            />
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Signature</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data!.map((t) => {
                  const v = verifyOf[t.id];
                  const official =
                    t.status === "APPROVED" || t.status === "LOCKED";
                  return (
                    <tr key={t.id}>
                      <td className="mono">{t.transcriptNumber}</td>
                      <td>{t.type.replace(/_/g, " ").toLowerCase()}</td>
                      <td>
                        <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td>
                        {v ? (
                          v.valid ? (
                            <span className="verify-ok">
                              <Icon name="check" size={14} /> Ed25519 valid
                            </span>
                          ) : v.revoked ? (
                            <span className="verify-bad">
                              <Icon name="shield" size={14} /> REVOKED
                            </span>
                          ) : !v.signatureValid ? (
                            <span className="verify-bad">
                              <Icon name="shield" size={14} /> INVALID signature
                            </span>
                          ) : !v.keyMatches ? (
                            <span className="verify-bad">
                              <Icon name="shield" size={14} /> key mismatch
                            </span>
                          ) : (
                            <span
                              className="verify-bad"
                              title="Signature valid but not an approved/issued transcript"
                            >
                              <Icon name="shield" size={14} /> not issued (
                              {v.status})
                            </span>
                          )
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div
                          className="row"
                          style={{ justifyContent: "flex-end", gap: 6 }}
                        >
                          <Button
                            variant="ghost"
                            disabled={sealed}
                            title={
                              sealed ? "Unseal the key to verify" : undefined
                            }
                            onClick={() => verify(t)}
                          >
                            Verify
                          </Button>
                          {t.status === "DRAFT" &&
                            can("transcripts.approve") && (
                              <Button
                                variant="ghost"
                                onClick={() => approve(t)}
                              >
                                Approve
                              </Button>
                            )}
                          {t.status === "APPROVED" &&
                            can("transcripts.approve") && (
                              <Button variant="ghost" onClick={() => lock(t)}>
                                Lock
                              </Button>
                            )}
                          {official && can("transcripts.approve") && (
                            <Button variant="danger" onClick={() => revoke(t)}>
                              Revoke
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => showPreview(t)}
                          >
                            Preview
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!official}
                            title={
                              official
                                ? undefined
                                : "Approve before official export"
                            }
                            onClick={() => exportOfficial(t)}
                          >
                            <Icon name="download" size={14} /> Export
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {unsealOpen && (
        <UnsealModal
          onClose={() => setUnsealOpen(false)}
          onDone={() => {
            setUnsealOpen(false);
            notify("Signing key unsealed for this session");
          }}
        />
      )}

      {preview && (
        <Modal
          title={`Preview · ${preview.number}`}
          subtitle="A4 preview — watermarked DRAFT, not an official copy."
          onClose={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        >
          <object
            className="a4-preview"
            data={preview.url}
            type="application/pdf"
            aria-label="Transcript A4 preview"
          >
            <div className="muted">
              Preview unavailable — use Export to download.
            </div>
          </object>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function KeyBanner({
  sealed,
  onUnseal,
}: {
  sealed: boolean;
  onUnseal: () => void;
}) {
  const { can } = useSession();
  const { seal } = useKeyState();
  return (
    <div className={`keybar ${sealed ? "sealed" : "unsealed"}`}>
      <Icon name={sealed ? "key" : "shield"} size={16} />
      <span className="grow">
        {sealed
          ? "Signing key is sealed. Unseal it with the institution passphrase to generate or verify transcripts."
          : "Signing key is unsealed for this session."}
      </span>
      {can("transcripts.generate") &&
        (sealed ? (
          <Button variant="primary" onClick={onUnseal}>
            Unseal key
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => void seal()}>
            Seal now
          </Button>
        ))}
    </div>
  );
}

function UnsealModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { unseal } = useKeyState();
  const [passphrase, setPassphrase] = useState("");
  const act = useAction(() => unseal(passphrase), { onSuccess: onDone });
  return (
    <Modal
      title="Unseal signing key"
      subtitle="Held in memory for this session only. A lost passphrase is unrecoverable."
      onClose={onClose}
    >
      <Field label="Institution passphrase">
        <input
          className="input"
          type="password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && passphrase && act.run()}
        />
      </Field>
      {act.error && <div className="alert danger">{act.error.message}</div>}
      <div className="actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!passphrase}
          loading={act.loading}
          onClick={act.run}
        >
          Unseal
        </Button>
      </div>
    </Modal>
  );
}
