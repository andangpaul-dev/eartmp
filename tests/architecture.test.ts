/**
 * Architecture fitness test.
 *
 * Mechanically enforces the Clean Architecture dependency rule so a violation
 * fails CI independently of the ESLint boundary rule (defence in depth, AD2):
 *
 *   - domain/      may import NOTHING outward and no framework (React/Prisma/Tauri).
 *   - application/ may import domain only; no infrastructure/presentation/framework.
 *   - presentation/ may not import infrastructure (UI must not touch the DB).
 *
 * It also self-verifies: synthetic "bad" sources are fed to the same detector
 * and MUST be flagged, proving the check actually catches violations (the
 * bad-import fixture, without shipping a file that breaks the build).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Extract the raw module specifiers from `import ... from "x"` statements. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]!);
  return specs;
}

const FRAMEWORK = [/^react(\/|$|-dom)/, /^@prisma\//, /^@tauri-apps\//];

/**
 * Returns the list of forbidden specifiers a source imports, given its layer.
 * Pure string analysis so it can be unit-tested with synthetic input.
 */
function forbiddenImports(
  source: string,
  layer: "domain" | "application" | "presentation",
): string[] {
  const bad: string[] = [];
  for (const spec of importSpecifiers(source)) {
    const isRelative = spec.startsWith(".");
    const crossesTo = (seg: string) =>
      spec.includes(`/${seg}/`) || spec.includes(`@${seg}`);

    if (layer === "domain") {
      if (FRAMEWORK.some((r) => r.test(spec))) bad.push(spec);
      if (
        isRelative &&
        (crossesTo("application") ||
          crossesTo("infrastructure") ||
          crossesTo("presentation"))
      )
        bad.push(spec);
    }
    if (layer === "application") {
      if (FRAMEWORK.some((r) => r.test(spec))) bad.push(spec);
      if (
        isRelative &&
        (crossesTo("infrastructure") || crossesTo("presentation"))
      )
        bad.push(spec);
    }
    if (layer === "presentation") {
      if (isRelative && crossesTo("infrastructure")) bad.push(spec);
    }
  }
  return bad;
}

describe("architecture: domain layer is pure", () => {
  it("imports nothing from outer layers or frameworks", () => {
    const offenders = tsFiles(join(SRC, "domain")).flatMap((f) => {
      const bad = forbiddenImports(readFileSync(f, "utf8"), "domain");
      return bad.length ? [`${f}: ${bad.join(", ")}`] : [];
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("architecture: application layer depends only inward", () => {
  it("does not import infrastructure, presentation or frameworks", () => {
    const offenders = tsFiles(join(SRC, "application")).flatMap((f) => {
      const bad = forbiddenImports(readFileSync(f, "utf8"), "application");
      return bad.length ? [`${f}: ${bad.join(", ")}`] : [];
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("architecture: presentation never touches the database", () => {
  it("does not import infrastructure directly", () => {
    const offenders = tsFiles(join(SRC, "presentation")).flatMap((f) => {
      const bad = forbiddenImports(readFileSync(f, "utf8"), "presentation");
      return bad.length ? [`${f}: ${bad.join(", ")}`] : [];
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("architecture: the detector actually catches violations", () => {
  it("flags a domain file importing Prisma", () => {
    const src = `import { PrismaClient } from "@prisma/client";`;
    expect(forbiddenImports(src, "domain")).toContain("@prisma/client");
  });
  it("flags a domain file importing React", () => {
    const src = `import React from "react";`;
    expect(forbiddenImports(src, "domain")).toContain("react");
  });
  it("flags a domain file reaching into infrastructure", () => {
    const src = `import { db } from "../../infrastructure/db/prisma";`;
    expect(forbiddenImports(src, "domain").length).toBeGreaterThan(0);
  });
  it("flags an application file importing infrastructure", () => {
    const src = `import { Repo } from "../../infrastructure/repositories/x";`;
    expect(forbiddenImports(src, "application").length).toBeGreaterThan(0);
  });
  it("flags presentation importing infrastructure", () => {
    const src = `import { Repo } from "../../infrastructure/repositories/x";`;
    expect(forbiddenImports(src, "presentation").length).toBeGreaterThan(0);
  });
  it("allows a clean domain import", () => {
    const src = `import { GradeScale } from "../value-objects/GradeScale";`;
    expect(forbiddenImports(src, "domain")).toEqual([]);
  });
});
