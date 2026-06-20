/**
 * Unit tests for GenerateMatricule application service (Workstream C, Task 2.2).
 * Uses in-memory fakes — no database required.
 */
import { describe, it, expect } from "vitest";
import {
  GenerateMatricule,
  type MatriculeSettingsPort,
  type MatriculeLookups,
} from "../../src/application/services/GenerateMatricule";
import type { MatriculeCounterRepository } from "../../src/domain/repositories/records";
import { fakeUow } from "../results/fakes";

// ---------------------------------------------------------------------------
// Minimal fakes
// ---------------------------------------------------------------------------

function makeSettings(
  rule: string,
  checkScheme: "none" | "luhn" | "mod97" = "none",
): MatriculeSettingsPort {
  return {
    async matriculeRule() {
      return rule;
    },
    async matriculeCheckScheme() {
      return checkScheme;
    },
    async matriculeFormat() {
      return "";
    },
  };
}

function makeLookups(
  opts: {
    facultyCode?: string;
    departmentCode?: string;
    institutionCode?: string;
  } = {},
): MatriculeLookups {
  return {
    async facultyCode(_id: string) {
      return opts.facultyCode;
    },
    async departmentCode(_id: string | undefined) {
      return opts.departmentCode;
    },
    async institutionCode(_id: string | null) {
      return opts.institutionCode;
    },
  };
}

class SpyMatriculeCounter implements MatriculeCounterRepository {
  private counters = new Map<string, number>();
  reserveCallCount = 0;
  peekCallCount = 0;
  private key(i: string | null, f: string, y: number) {
    return `${i}:${f}:${y}`;
  }
  async peek(institutionId: string | null, facultyId: string, year: number) {
    this.peekCallCount++;
    return this.counters.get(this.key(institutionId, facultyId, year)) ?? 1;
  }
  async reserve(institutionId: string | null, facultyId: string, year: number) {
    this.reserveCallCount++;
    const k = this.key(institutionId, facultyId, year);
    const current = this.counters.get(k) ?? 1;
    this.counters.set(k, current + 1);
    return current;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateMatricule", () => {
  it("reserves and expands using faculty code + admission year", async () => {
    const spy = new SpyMatriculeCounter();
    const uow = fakeUow({ matriculeCounter: spy });
    const svc = new GenerateMatricule(
      makeSettings("{faculty}{year2}-{seq:0000}"),
      makeLookups({ facultyCode: "FS" }),
    );

    let result!: string;
    await uow.run(async (repos) => {
      result = await svc.generate(
        {
          institutionId: null,
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        repos,
        "reserve",
      );
    });

    expect(result).toBe("FS25-0001");
    expect(spy.reserveCallCount).toBe(1);
  });

  it("peek does not consume the counter", async () => {
    const spy = new SpyMatriculeCounter();
    const uow = fakeUow({ matriculeCounter: spy });
    const svc = new GenerateMatricule(
      makeSettings("{faculty}{year2}-{seq:0000}"),
      makeLookups({ facultyCode: "FS" }),
    );

    await uow.run(async (repos) => {
      await svc.generate(
        {
          institutionId: null,
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        repos,
        "peek",
      );
      await svc.generate(
        {
          institutionId: null,
          facultyId: "facA",
          admissionSession: "2025/2026",
        },
        repos,
        "peek",
      );
    });

    // Two peeks — counter should never have been incremented, so peek still
    // returns 1.
    expect(await spy.peek(null, "facA", 2025)).toBe(1);
    expect(spy.reserveCallCount).toBe(0);
  });

  it("errors when {faculty} present but faculty has no code", async () => {
    const spy = new SpyMatriculeCounter();
    const uow = fakeUow({ matriculeCounter: spy });
    const svc = new GenerateMatricule(
      makeSettings("{faculty}{year2}-{seq:0000}"),
      makeLookups({ facultyCode: undefined }),
    );

    await expect(
      uow.run((repos) =>
        svc.generate(
          {
            institutionId: null,
            facultyId: "facA",
            admissionSession: "2025/2026",
          },
          repos,
          "reserve",
        ),
      ),
    ).rejects.toThrow(/code/i);
  });
});
