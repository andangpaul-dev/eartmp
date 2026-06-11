/**
 * TranscriptBinder — binds a template layout (JSON block tree) to a ReportData,
 * producing a format-agnostic ResolvedDoc (Phase 12, AD12.1). Pure: no I/O, no
 * rendering libraries — the PDF/DOCX renderers (P13/14) consume the ResolvedDoc.
 *
 * Binding rules (AD12.6 — fail loud):
 *   - `value`    : a literal.
 *   - `bind`     : a dotted path into the data; REQUIRED — unresolved → error.
 *   - `template` : `{{path}}` interpolation; LENIENT — missing → empty string.
 * So template authors use `bind` for required fields and `template` for optional.
 */
import { TranscriptError } from "../errors/transcript";
import type {
  ReportData,
  ResolvedBlock,
  ResolvedDoc,
  ReportSession,
  ReportCourse,
} from "./TranscriptReportData";

type Obj = Record<string, unknown>;

function asObject(v: unknown, where: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new TranscriptError(`Template ${where} must be an object.`);
  }
  return v as Obj;
}
function asArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new TranscriptError(`Template ${where} must be an array.`);
  }
  return v;
}

function resolvePath(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Obj)[key];
    }
    return undefined;
  }, data);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function interpolate(template: string, ctx: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_m, path: string) =>
    stringify(resolvePath(ctx, path.trim())),
  );
}

/** Resolve a field spec ({ value | bind | template }) against a context. */
function resolveValue(field: Obj, ctx: unknown, where: string): string {
  if (field.value !== undefined) return stringify(field.value);
  if (typeof field.template === "string")
    return interpolate(field.template, ctx);
  if (typeof field.bind === "string") {
    const v = resolvePath(ctx, field.bind);
    if (v === undefined) {
      throw new TranscriptError(
        `Unresolved required bind "${field.bind}" in ${where}.`,
      );
    }
    return stringify(v);
  }
  throw new TranscriptError(`${where} needs a value, bind, or template.`);
}

function resolveBlock(block: Obj, data: ReportData): ResolvedBlock[] {
  const type = block.type;
  switch (type) {
    case "title":
      return [{ type: "title", text: stringify(block.value) }];
    case "text":
      return [{ type: "text", text: resolveValue(block, data, "text block") }];
    case "remarks":
      return [
        {
          type: "remarks",
          text:
            typeof block.bind === "string"
              ? stringify(resolvePath(data, block.bind))
              : stringify(block.value),
        },
      ];
    case "qr": {
      const payload =
        typeof block.bind === "string"
          ? stringify(resolvePath(data, block.bind))
          : stringify(block.value);
      const caption =
        typeof block.caption === "string"
          ? stringify(resolvePath(data, block.caption))
          : undefined;
      return [
        caption ? { type: "qr", payload, caption } : { type: "qr", payload },
      ];
    }
    case "fieldGrid": {
      const columns = typeof block.columns === "number" ? block.columns : 1;
      const fields = asArray(block.fields, "fieldGrid.fields").map((f, i) => {
        const fo = asObject(f, `fieldGrid.fields[${i}]`);
        return {
          label: stringify(fo.label),
          value: resolveValue(fo, data, `fieldGrid.fields[${i}]`),
        };
      });
      return [{ type: "fieldGrid", columns, fields }];
    }
    case "summary": {
      const fields = asArray(block.fields, "summary.fields").map((f, i) => {
        const fo = asObject(f, `summary.fields[${i}]`);
        return {
          label: stringify(fo.label),
          value: resolveValue(fo, data, `summary.fields[${i}]`),
        };
      });
      return [{ type: "summary", fields }];
    }
    case "signatureRow":
      return [
        {
          type: "signatureRow",
          items: data.signatures.map((s) => ({
            role: s.role,
            name: s.name ?? "",
            ...(s.imagePath ? { image: s.imagePath } : {}),
          })),
        },
      ];
    case "sessionLoop": {
      const child = asObject(block.block, "sessionLoop.block");
      if (child.type !== "courseTable") {
        throw new TranscriptError("sessionLoop.block must be a courseTable.");
      }
      return data.sessions.map((session) => resolveCourseTable(child, session));
    }
    case "courseTable":
      // Standalone course table over all sessions' courses is unusual; require a loop.
      throw new TranscriptError("courseTable must live inside a sessionLoop.");
    default:
      throw new TranscriptError(
        `Unknown template block type "${stringify(type)}".`,
      );
  }
}

function resolveCourseTable(block: Obj, session: ReportSession): ResolvedBlock {
  const heading =
    typeof block.groupHeading === "string"
      ? interpolate(block.groupHeading, session)
      : "";
  const columnSpecs = asArray(block.columns, "courseTable.columns").map(
    (c, i) => asObject(c, `courseTable.columns[${i}]`),
  );
  const columns = columnSpecs.map((c) => ({ header: stringify(c.header) }));
  const rows = session.courses.map((course: ReportCourse) =>
    columnSpecs.map((c) =>
      typeof c.bind === "string"
        ? stringify(resolvePath(course, c.bind))
        : stringify(c.value),
    ),
  );
  const footer = (
    block.footer ? asArray(block.footer, "courseTable.footer") : []
  ).map((f, i) => {
    const fo = asObject(f, `courseTable.footer[${i}]`);
    return {
      label: stringify(fo.label),
      value:
        typeof fo.bind === "string"
          ? stringify(resolvePath(session, fo.bind))
          : stringify(fo.value),
    };
  });
  return { type: "courseTable", heading, columns, rows, footer };
}

export function bindTemplate(layout: unknown, data: ReportData): ResolvedDoc {
  const root = asObject(layout, "layout");
  const pageSize = typeof root.pageSize === "string" ? root.pageSize : "A4";
  const blocks = asArray(root.blocks, "layout.blocks");
  const resolved: ResolvedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    resolved.push(
      ...resolveBlock(asObject(blocks[i], `layout.blocks[${i}]`), data),
    );
  }
  return { pageSize, blocks: resolved };
}
