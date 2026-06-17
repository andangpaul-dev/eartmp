/**
 * Tenant isolation helper (Phase D). A scoped operator (session bound to one
 * institution) may only ever see/touch that institution's data; a global
 * operator is unrestricted. The host forces the institution filter here so a
 * caller-supplied `where` can never widen past the operator's scope.
 */
import type { SessionContext } from "../../domain/value-objects/SessionContext";
import { AuthorizationError } from "../../domain/errors/auth";

/** Force `institutionId` onto a list filter for a scoped operator. */
export function scopeWhere<T extends { institutionId?: string }>(
  where: T | undefined,
  session: SessionContext,
): T | undefined {
  if (session.isGlobal) return where;
  return { ...((where ?? {}) as T), institutionId: session.institutionId };
}

/**
 * Assert a row belongs to the operator's institution before a mutation. Global
 * operators pass; a scoped operator is rejected for any other institution.
 */
export function assertInScope(
  rowInstitutionId: string | undefined,
  session: SessionContext,
): boolean {
  return session.isGlobal || rowInstitutionId === session.institutionId;
}

/** The institution a created row must belong to, for a scoped operator. */
export function scopedInstitutionId(
  requested: string | undefined,
  session: SessionContext,
): string | undefined {
  return session.isGlobal ? requested : session.institutionId;
}

/** Throw FORBIDDEN if a scoped operator targets another institution's row. */
export function requireInScope(
  rowInstitutionId: string | undefined,
  session: SessionContext,
): void {
  if (!assertInScope(rowInstitutionId, session)) {
    throw new AuthorizationError("This record belongs to another institution.");
  }
}
