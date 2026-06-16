/**
 * Unit tests for the SQL statement splitter used by the runtime migration
 * runner. The win over a naive `split(";")` is that semicolons inside string
 * literals and comments don't break a statement.
 */
import { describe, it, expect } from "vitest";
import { splitSqlStatements } from "../../src/infrastructure/db/migrationRunner";

describe("splitSqlStatements", () => {
  it("splits top-level statements and trims", () => {
    expect(
      splitSqlStatements("CREATE TABLE a (id);\nINSERT INTO a VALUES (1);"),
    ).toEqual(["CREATE TABLE a (id)", "INSERT INTO a VALUES (1)"]);
  });

  it("ignores a trailing statement with no terminating semicolon", () => {
    expect(splitSqlStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("does not split on a semicolon inside a single-quoted string", () => {
    expect(
      splitSqlStatements("INSERT INTO t (v) VALUES ('a;b');SELECT 1;"),
    ).toEqual(["INSERT INTO t (v) VALUES ('a;b')", "SELECT 1"]);
  });

  it("handles escaped quotes ('') inside a string", () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('it''s; fine');")).toEqual(
      ["INSERT INTO t VALUES ('it''s; fine')"],
    );
  });

  it("does not split on a semicolon inside a quoted identifier", () => {
    expect(splitSqlStatements('CREATE TABLE "we;ird" (id);')).toEqual([
      'CREATE TABLE "we;ird" (id)',
    ]);
  });

  it("strips line comments, including ones containing semicolons", () => {
    const sql = "CREATE TABLE a (id); -- a; b; c\nSELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE TABLE a (id)",
      "SELECT 1",
    ]);
  });

  it("strips block comments", () => {
    const sql = "CREATE TABLE a (id); /* drop; everything; */ SELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      "CREATE TABLE a (id)",
      "SELECT 1",
    ]);
  });

  it("keeps PRAGMA statements as their own statements", () => {
    const sql =
      "PRAGMA defer_foreign_keys=ON;\nPRAGMA foreign_keys=OFF;\nCREATE TABLE a (id);";
    expect(splitSqlStatements(sql)).toEqual([
      "PRAGMA defer_foreign_keys=ON",
      "PRAGMA foreign_keys=OFF",
      "CREATE TABLE a (id)",
    ]);
  });

  it("returns nothing for an empty / comment-only script", () => {
    expect(
      splitSqlStatements("-- just a comment\n/* and a block */\n"),
    ).toEqual([]);
  });
});
