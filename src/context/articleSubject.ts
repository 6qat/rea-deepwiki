import type { DeepWikiSymbol, SymbolRange } from "../types.ts";

/** A document reduced to the facts the article-subject module needs. */
export interface SubjectDocument {
  uri: string;
  languageId: string;
  lineCount: number;
  lineAt(line: number): string;
}

export interface WordSpan {
  text: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface DefinitionSpan {
  uri: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface OutlineSymbol {
  kind: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  children: OutlineSymbol[];
}

/**
 * Editor lookups. Production fills these from the editor host; tests pass a
 * mock adapter.
 */
export interface SubjectLookups {
  wordAt(uri: string, line: number, character: number): WordSpan | null;
  definitions(uri: string, line: number, character: number): Promise<DefinitionSpan[]>;
  openDocument(uri: string): Promise<SubjectDocument>;
  outline(uri: string): Promise<OutlineSymbol[]>;
  relativePath(uri: string): string;
}

export interface DiagnosticFacts {
  message: string;
  source?: string;
  code?: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** Prefer an exact name, otherwise the first hit. */
export function pickNamedHit<T extends { name: string }>(
  hits: readonly T[],
  name: string,
): T | undefined {
  return hits.find((hit) => hit.name === name) ?? hits[0];
}

/**
 * From a cursor position, produce the article subject: the word under the
 * cursor, jumped to its definition when one exists, with one excerpt shape.
 */
export async function resolveSubject(
  lookups: SubjectLookups,
  cursor: { uri: string; line: number; character: number },
): Promise<DeepWikiSymbol | null> {
  const word = lookups.wordAt(cursor.uri, cursor.line, cursor.character);
  if (!word) return null;

  let target: DefinitionSpan = {
    uri: cursor.uri,
    startLine: word.startLine,
    startCharacter: word.startCharacter,
    endLine: word.endLine,
    endCharacter: word.endCharacter,
  };

  try {
    const definitions = await lookups.definitions(cursor.uri, cursor.line, cursor.character);
    const first = definitions[0];
    if (first) target = first;
  } catch {
    // Stay on the word under the cursor.
  }

  let doc: SubjectDocument;
  try {
    doc = await lookups.openDocument(target.uri);
  } catch {
    doc = await lookups.openDocument(cursor.uri);
    target = {
      uri: cursor.uri,
      startLine: word.startLine,
      startCharacter: word.startCharacter,
      endLine: word.endLine,
      endCharacter: word.endCharacter,
    };
  }

  let outline: OutlineSymbol[] = [];
  try {
    outline = await lookups.outline(target.uri);
  } catch {
    outline = [];
  }

  const match = findOutline(outline, target.startLine, target.startCharacter);
  let kind = match?.kind ?? "Symbol";
  const anchorStart = match?.startLine ?? target.startLine;
  const anchorEnd = match?.endLine ?? target.endLine;

  if (kind === "Symbol") {
    kind = kindFromLine(doc.lineAt(target.startLine)) ?? "Symbol";
  }

  const selectionRange: SymbolRange = {
    startLine: target.startLine + 1,
    startColumn: target.startCharacter + 1,
    endLine: target.endLine + 1,
    endColumn: target.endCharacter + 1,
  };

  return {
    name: word.text,
    kind,
    uri: target.uri,
    relativePath: lookups.relativePath(target.uri),
    selectionRange,
    enclosingCode: formatExcerpt(doc, target.startLine, target.startLine, anchorStart, anchorEnd),
    languageId: doc.languageId,
  };
}

/** A diagnostic becomes an article subject with the same excerpt shape as a symbol. */
export function subjectFromDiagnostic(
  doc: SubjectDocument,
  relativePath: string,
  diagnostic: DiagnosticFacts,
): DeepWikiSymbol {
  const code = diagnostic.code ? ` (${diagnostic.code})` : "";
  const name = diagnostic.source
    ? `${diagnostic.source}${code}: ${diagnostic.message}`
    : diagnostic.message;

  return {
    name,
    kind: "Diagnostic",
    uri: doc.uri,
    relativePath,
    selectionRange: {
      startLine: diagnostic.startLine + 1,
      startColumn: diagnostic.startCharacter + 1,
      endLine: diagnostic.endLine + 1,
      endColumn: diagnostic.endCharacter + 1,
    },
    enclosingCode: formatExcerpt(
      doc,
      diagnostic.startLine,
      diagnostic.endLine,
      diagnostic.startLine,
      diagnostic.endLine,
    ),
    languageId: doc.languageId,
  };
}

function formatExcerpt(
  doc: SubjectDocument,
  markStart: number,
  markEnd: number,
  anchorStart: number,
  anchorEnd: number,
): string {
  const startLine = Math.max(0, anchorStart - 10);
  const endLine = Math.min(doc.lineCount - 1, Math.max(anchorEnd + 10, startLine + 80));
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const prefix = i >= markStart && i <= markEnd ? "> " : "  ";
    lines.push(`${prefix}${i + 1}: ${doc.lineAt(i)}`);
  }
  return lines.join("\n");
}

function findOutline(
  symbols: OutlineSymbol[],
  line: number,
  character: number,
): OutlineSymbol | null {
  for (const sym of symbols) {
    if (!contains(sym, line, character)) continue;
    const child = findOutline(sym.children, line, character);
    return child ?? sym;
  }
  return null;
}

function contains(
  span: { startLine: number; startCharacter: number; endLine: number; endCharacter: number },
  line: number,
  character: number,
): boolean {
  if (line < span.startLine || line > span.endLine) return false;
  if (line === span.startLine && character < span.startCharacter) return false;
  if (line === span.endLine && character >= span.endCharacter) return false;
  return true;
}

function kindFromLine(line: string): string | null {
  if (/\b(function|def|fn|func)\b/i.test(line)) return "Function";
  if (/\b(class|struct)\b/i.test(line)) return "Class";
  if (/\b(interface|trait|type)\b/i.test(line)) return "Interface";
  if (/\b(enum)\b/i.test(line)) return "Enum";
  if (/\b(const|let|var|val)\b/i.test(line)) return "Variable";
  return null;
}
