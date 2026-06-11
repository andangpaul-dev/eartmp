/**
 * Prisma-backed structure-name resolver for transcripts — DEV-ONLY adapter
 * (collapses the structure lookups behind one resolver, see BuildReportData).
 */
import type { PrismaClient } from "@prisma/client";
import type { TranscriptNameResolver } from "../../application/use-cases/transcripts/BuildReportData";

const live = { deletedAt: null } as const;

export class PrismaTranscriptNameResolver implements TranscriptNameResolver {
  constructor(private readonly db: PrismaClient) {}

  async programmeName(id?: string): Promise<string | undefined> {
    if (!id) return undefined;
    const r = await this.db.programme.findFirst({ where: { id, ...live } });
    return r?.name;
  }
  async departmentName(id?: string): Promise<string | undefined> {
    if (!id) return undefined;
    const r = await this.db.department.findFirst({ where: { id, ...live } });
    return r?.name;
  }
  async facultyName(id?: string): Promise<string | undefined> {
    if (!id) return undefined;
    const r = await this.db.faculty.findFirst({ where: { id, ...live } });
    return r?.name;
  }
  async semesterName(semesterId: string): Promise<string | undefined> {
    const r = await this.db.semester.findFirst({
      where: { id: semesterId, ...live },
    });
    return r?.name;
  }
  async sessionNameForSemester(
    semesterId: string,
  ): Promise<string | undefined> {
    const sem = await this.db.semester.findFirst({
      where: { id: semesterId, ...live },
    });
    if (!sem) return undefined;
    const sess = await this.db.academicSession.findFirst({
      where: { id: sem.sessionId, ...live },
    });
    return sess?.name;
  }
}
