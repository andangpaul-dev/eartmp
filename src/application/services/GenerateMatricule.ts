/**
 * GenerateMatricule — application service for matricule generation (WS C).
 *
 * Supports two modes:
 *  - "peek":    expand using the current counter value WITHOUT incrementing.
 *  - "reserve": claim the next sequence number atomically, then expand.
 *
 * Depends on:
 *  - MatriculeSettingsPort  — runtime rule / check-scheme / format config.
 *  - MatriculeLookups       — resolves faculty / department / institution codes.
 *  - TransactionalRepos     — provides the MatriculeCounterRepository (repos.matriculeCounter).
 */
import {
  expandMatricule,
  admissionYear,
} from "../../domain/services/Matricule";
import type { CheckScheme } from "../../domain/services/MatriculeCheck";
import { RecordsError } from "../../domain/errors/records";
import type { TransactionalRepos } from "../ports/UnitOfWork";

export type MatriculeMode = "peek" | "reserve";

export interface MatriculeContext {
  institutionId: string | null;
  facultyId: string;
  departmentId?: string;
  admissionSession: string;
}

export interface MatriculeSettingsPort {
  matriculeRule(): Promise<string>;
  matriculeCheckScheme(): Promise<CheckScheme>;
  matriculeFormat(): Promise<string>;
}

export interface MatriculeLookups {
  facultyCode(facultyId: string): Promise<string | undefined>;
  departmentCode(departmentId: string | undefined): Promise<string | undefined>;
  institutionCode(institutionId: string | null): Promise<string | undefined>;
}

export class GenerateMatricule {
  constructor(
    private readonly settings: MatriculeSettingsPort,
    private readonly lookups: MatriculeLookups,
  ) {}

  async generate(
    ctx: MatriculeContext,
    repos: TransactionalRepos,
    mode: MatriculeMode,
  ): Promise<string> {
    const rule = await this.settings.matriculeRule();
    const checkScheme = await this.settings.matriculeCheckScheme();

    const facultyCode = await this.lookups.facultyCode(ctx.facultyId);
    if (rule.includes("{faculty}") && !facultyCode) {
      throw new RecordsError(
        "The selected faculty has no code for the matricule.",
      );
    }

    const dept = await this.lookups.departmentCode(ctx.departmentId);
    const institutionCode = await this.lookups.institutionCode(
      ctx.institutionId,
    );
    const year = admissionYear(ctx.admissionSession);

    const seq =
      mode === "reserve"
        ? await repos.matriculeCounter.reserve(
            ctx.institutionId,
            ctx.facultyId,
            year,
          )
        : await repos.matriculeCounter.peek(
            ctx.institutionId,
            ctx.facultyId,
            year,
          );

    return expandMatricule(rule, {
      institutionCode,
      faculty: facultyCode,
      dept,
      year,
      seq,
      checkScheme,
    });
  }
}
