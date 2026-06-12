/**
 * Audit read use-cases (Phase 19). `GetAuditLog` queries the trail (filters +
 * pagination); `VerifyAuditChain` recomputes the tamper-evident hash chain and
 * reports the first broken link. Both gated by `audit.read`.
 */
import { SessionContext } from "../../../domain/value-objects/SessionContext";
import {
  verifyAuditChain,
  type AuditEntry,
  type ChainVerification,
} from "../../../domain/services/AuditChain";
import type {
  AuditLogQueryRepository,
  AuditQuery,
} from "../../../domain/repositories/audit";
import type { Page } from "../../../domain/repositories/records";
import type { AuditHasher } from "../../ports/AuditHasher";
import type { AuthorizedUseCase } from "../../authorization/AuthorizedUseCase";

const MAX_TAKE = 200;

export class GetAuditLog implements AuthorizedUseCase<
  AuditQuery,
  Page<AuditEntry>
> {
  readonly name = "GetAuditLog";
  readonly requiredPermissions = ["audit.read"];
  constructor(private readonly repo: AuditLogQueryRepository) {}

  async execute(
    input: AuditQuery,
    _session: SessionContext,
  ): Promise<Page<AuditEntry>> {
    const take = Math.min(input.take ?? 50, MAX_TAKE);
    return this.repo.find({ ...input, take });
  }
}

export class VerifyAuditChain implements AuthorizedUseCase<
  Record<string, never>,
  ChainVerification
> {
  readonly name = "VerifyAuditChain";
  readonly requiredPermissions = ["audit.read"];
  constructor(
    private readonly repo: AuditLogQueryRepository,
    private readonly hasher: AuditHasher,
  ) {}

  async execute(
    _input: Record<string, never>,
    _session: SessionContext,
  ): Promise<ChainVerification> {
    const ordered = await this.repo.listOrdered();
    return verifyAuditChain(ordered, (prev, payload) =>
      this.hasher.hash(prev + payload),
    );
  }
}
