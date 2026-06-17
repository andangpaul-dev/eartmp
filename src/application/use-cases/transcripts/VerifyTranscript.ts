/**
 * VerifyTranscript / ApproveTranscript (Phase 12).
 *
 * VerifyTranscript recomputes nothing live — it verifies the stored snapshot's
 * signature with the institution public key (ADR-009 / F-14). A tampered
 * snapshot fails. ApproveTranscript moves a DRAFT to APPROVED (status workflow,
 * TranscriptRules); only APPROVED/LOCKED transcripts may be exported (P13).
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import { TranscriptError } from "../../../domain/errors/transcript";
import {
  TranscriptRules,
  type TranscriptStatus,
} from "../../../domain/entities";
import type {
  TranscriptStore,
  StoredTranscript,
} from "../../../domain/repositories/transcripts";
import type { AuditLogPort } from "../../../domain/repositories";
import type { SignaturePort } from "../../ports/SignaturePort";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

export interface VerifyTranscriptInput {
  transcriptId: string;
}

/**
 * Resolves a verify-only signer for the transcript's issuing institution (Phase
 * F). Uses only the public key (no passphrase / unseal). Returns null when no
 * key exists for that institution.
 */
export type VerifierResolver = (
  institutionId?: string,
) => Promise<SignaturePort | null>;

export interface VerifyResult {
  /** True only if the signature verifies AND the transcript is a current,
   *  non-revoked issue signed by the current key. */
  valid: boolean;
  transcriptNumber: string;
  status: string;
  /** Whether the signature itself verifies (independent of status/key). */
  signatureValid: boolean;
  revoked: boolean;
  /** False if signed by a different (rotated) key than the current one. */
  keyMatches: boolean;
}

export class VerifyTranscript implements AuthorizedUseCase<
  VerifyTranscriptInput,
  VerifyResult
> {
  readonly name = "VerifyTranscript";
  readonly requiredPermissions = ["transcripts.read"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly resolveVerifier: VerifierResolver,
  ) {}

  async execute(
    input: VerifyTranscriptInput,
    _session: SessionContext,
  ): Promise<VerifyResult> {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");

    const base = {
      transcriptNumber: t.transcriptNumber,
      status: t.status,
      revoked: t.status === "REVOKED",
    };
    let parsed: { signature: string; keyId?: string };
    try {
      parsed = JSON.parse(t.verificationHash) as {
        signature: string;
        keyId?: string;
      };
    } catch {
      return {
        ...base,
        valid: false,
        signatureValid: false,
        keyMatches: false,
      };
    }

    // Verify against the issuing institution's public key (Phase F). No key
    // for that institution → nothing can verify.
    const signer = await this.resolveVerifier(t.institutionId ?? undefined);
    if (!signer) {
      return {
        ...base,
        valid: false,
        signatureValid: false,
        keyMatches: false,
      };
    }

    const signatureValid = signer.verify(t.snapshot, parsed.signature);
    // If the current key id is known, the signing key must match (detects a
    // rotated/replaced key). Unknown current key id → don't penalize.
    const keyMatches =
      signer.keyId && parsed.keyId ? parsed.keyId === signer.keyId : true;
    // A signature can be valid yet the transcript not be a trustworthy issue:
    // only APPROVED/LOCKED, non-revoked, current-key transcripts are "valid".
    const issued = t.status === "APPROVED" || t.status === "LOCKED";
    return {
      ...base,
      signatureValid,
      keyMatches,
      valid: signatureValid && keyMatches && issued,
    };
  }
}

export interface LockTranscriptInput {
  transcriptId: string;
}
export class LockTranscript implements AuthorizedUseCase<
  LockTranscriptInput,
  StoredTranscript
> {
  readonly name = "LockTranscript";
  readonly requiredPermissions = ["transcripts.approve"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(input: LockTranscriptInput, session: SessionContext) {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");
    if (!TranscriptRules.canLock(t.status as TranscriptStatus)) {
      throw new TranscriptError(
        `Only an APPROVED transcript can be locked (is "${t.status}").`,
      );
    }
    const updated = await this.transcripts.updateStatus(
      input.transcriptId,
      "LOCKED",
    );
    await this.audit.record({
      userId: session.actorId,
      action: "LOCK",
      entity: "Transcript",
      recordId: input.transcriptId,
      oldValue: { status: t.status },
      newValue: { status: "LOCKED" },
    });
    return updated;
  }
}

export interface RevokeTranscriptInput {
  transcriptId: string;
  reason?: string;
}
export class RevokeTranscript implements AuthorizedUseCase<
  RevokeTranscriptInput,
  StoredTranscript
> {
  readonly name = "RevokeTranscript";
  readonly requiredPermissions = ["transcripts.approve"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(input: RevokeTranscriptInput, session: SessionContext) {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");
    if (!TranscriptRules.canRevoke(t.status as TranscriptStatus)) {
      throw new TranscriptError(
        `Only an issued transcript can be revoked (is "${t.status}").`,
      );
    }
    const updated = await this.transcripts.updateStatus(
      input.transcriptId,
      "REVOKED",
    );
    await this.audit.record({
      userId: session.actorId,
      action: "REVOKE",
      entity: "Transcript",
      recordId: input.transcriptId,
      oldValue: { status: t.status },
      newValue: { status: "REVOKED", reason: input.reason ?? null },
    });
    return updated;
  }
}

export interface ApproveTranscriptInput {
  transcriptId: string;
}
export class ApproveTranscript implements AuthorizedUseCase<
  ApproveTranscriptInput,
  StoredTranscript
> {
  readonly name = "ApproveTranscript";
  readonly requiredPermissions = ["transcripts.approve"];

  constructor(
    private readonly transcripts: TranscriptStore,
    private readonly audit: AuditLogPort,
  ) {}

  async execute(input: ApproveTranscriptInput, session: SessionContext) {
    const t = await this.transcripts.findById(input.transcriptId);
    if (!t) throw new TranscriptError("Transcript not found.");
    if (!TranscriptRules.isEditable(t.status as TranscriptStatus)) {
      throw new TranscriptError(
        `Transcript is "${t.status}" and cannot be approved.`,
      );
    }
    const updated = await this.transcripts.updateStatus(
      input.transcriptId,
      "APPROVED",
    );
    await this.audit.record({
      userId: session.actorId,
      action: "APPROVE",
      entity: "Transcript",
      recordId: input.transcriptId,
      oldValue: { status: t.status },
      newValue: { status: "APPROVED" },
    });
    return updated;
  }
}
