import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type OutlineSymbol,
  pickNamedHit,
  resolveSubject,
  type SubjectDocument,
  type SubjectLookups,
  subjectFromDiagnostic,
} from "./articleSubject.ts";

function document(uri: string, lines: string[], languageId = "typescript"): SubjectDocument {
  return {
    uri,
    languageId,
    lineCount: lines.length,
    lineAt: (line) => lines[line] ?? "",
  };
}

const excerptLine = /^(?:> | {2})\d+: /;

test("pickNamedHit prefers an exact name", () => {
  const hits = [{ name: "alpha" }, { name: "beta" }];
  assert.equal(pickNamedHit(hits, "beta")?.name, "beta");
  assert.equal(pickNamedHit(hits, "missing")?.name, "alpha");
  assert.equal(pickNamedHit([], "missing"), undefined);
});

test("a cursor on a call jumps to the definition and keeps the word", async () => {
  const call = document("file:///src/use.ts", ["", "", "    helper();"]);
  const def = document("file:///src/lib.ts", ["export function helper() {", "  return 1;", "}"]);
  const outline: OutlineSymbol[] = [
    {
      kind: "Function",
      startLine: 0,
      startCharacter: 0,
      endLine: 2,
      endCharacter: 1,
      children: [],
    },
  ];
  const lookups: SubjectLookups = {
    wordAt: () => ({
      text: "helper",
      startLine: 2,
      startCharacter: 4,
      endLine: 2,
      endCharacter: 10,
    }),
    definitions: async () => [
      { uri: def.uri, startLine: 0, startCharacter: 7, endLine: 0, endCharacter: 13 },
    ],
    openDocument: async (uri) => (uri === def.uri ? def : call),
    outline: async (uri) => (uri === def.uri ? outline : []),
    relativePath: (uri) => (uri === def.uri ? "src/lib.ts" : "src/use.ts"),
  };

  const subject = await resolveSubject(lookups, { uri: call.uri, line: 2, character: 6 });
  assert.ok(subject);
  assert.equal(subject.name, "helper");
  assert.equal(subject.kind, "Function");
  assert.equal(subject.relativePath, "src/lib.ts");
  assert.equal(subject.uri, def.uri);
  assert.match(subject.enclosingCode, /^> 1: export function helper/);
  assert.match(subject.enclosingCode.split("\n")[1] ?? "", excerptLine);
});

test("no definition stays on the cursor document", async () => {
  const doc = document("file:///src/a.ts", ["const value = 1;"]);
  const lookups: SubjectLookups = {
    wordAt: () => ({
      text: "value",
      startLine: 0,
      startCharacter: 6,
      endLine: 0,
      endCharacter: 11,
    }),
    definitions: async () => [],
    openDocument: async () => doc,
    outline: async () => [],
    relativePath: () => "src/a.ts",
  };

  const subject = await resolveSubject(lookups, { uri: doc.uri, line: 0, character: 6 });
  assert.ok(subject);
  assert.equal(subject.uri, doc.uri);
  assert.equal(subject.kind, "Variable");
  assert.match(subject.enclosingCode, /^> 1: const value = 1;/);
});

test("keyword fallback names a function when the outline is empty", async () => {
  const doc = document("file:///src/a.ts", ["function helper() {}"]);
  const lookups: SubjectLookups = {
    wordAt: () => ({
      text: "helper",
      startLine: 0,
      startCharacter: 9,
      endLine: 0,
      endCharacter: 15,
    }),
    definitions: async () => {
      throw new Error("no provider");
    },
    openDocument: async () => doc,
    outline: async () => [],
    relativePath: () => "src/a.ts",
  };

  const subject = await resolveSubject(lookups, { uri: doc.uri, line: 0, character: 10 });
  assert.ok(subject);
  assert.equal(subject.kind, "Function");
  assert.match(subject.enclosingCode, excerptLine);
});

test("a missing word produces no subject", async () => {
  const lookups: SubjectLookups = {
    wordAt: () => null,
    definitions: async () => [],
    openDocument: async () => document("file:///src/a.ts", [""]),
    outline: async () => [],
    relativePath: () => "src/a.ts",
  };
  assert.equal(
    await resolveSubject(lookups, { uri: "file:///src/a.ts", line: 0, character: 0 }),
    null,
  );
});

test("a diagnostic uses the same excerpt shape as a symbol", () => {
  const lines = Array.from({ length: 20 }, () => "const x = 1;");
  const doc = document("file:///src/a.ts", lines);
  const subject = subjectFromDiagnostic(doc, "src/a.ts", {
    message: "unused",
    source: "biome",
    code: "noUnused",
    startLine: 10,
    startCharacter: 0,
    endLine: 10,
    endCharacter: 5,
  });

  assert.equal(subject.kind, "Diagnostic");
  assert.equal(subject.name, "biome (noUnused): unused");
  assert.equal(subject.relativePath, "src/a.ts");
  const marked = subject.enclosingCode.split("\n").find((line) => line.startsWith("> "));
  assert.equal(marked, "> 11: const x = 1;");
  for (const line of subject.enclosingCode.split("\n")) {
    assert.match(line, excerptLine);
  }
  assert.doesNotMatch(subject.enclosingCode, /Diagnostic:/);
});
