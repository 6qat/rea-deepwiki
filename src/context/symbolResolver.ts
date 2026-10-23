import * as path from "node:path";
import * as vscode from "vscode";
import type { DeepWikiSymbol } from "../types.ts";
import {
  type DefinitionSpan,
  type OutlineSymbol,
  pickNamedHit,
  resolveSubject,
  type SubjectDocument,
  type SubjectLookups,
  subjectFromDiagnostic,
} from "./articleSubject.ts";

/**
 * Editor-host adapter for the article-subject module. Callers ask for a
 * subject from a cursor, a typed name, or a diagnostic.
 */
export class SymbolResolver {
  public static async resolveSymbolAt(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<DeepWikiSymbol | null> {
    return resolveSubject(lookupsFor(document), {
      uri: document.uri.toString(),
      line: position.line,
      character: position.character,
    });
  }

  public static async resolveByName(name: string): Promise<DeepWikiSymbol | null> {
    const hits =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        name,
      )) ?? [];
    const hit = pickNamedHit(hits, name);
    if (!hit) return null;
    const document = await vscode.workspace.openTextDocument(hit.location.uri);
    return SymbolResolver.resolveSymbolAt(document, hit.location.range.start);
  }

  public static subjectForDiagnostic(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
  ): DeepWikiSymbol {
    const code = diagnostic.code;
    const codeValue =
      typeof code === "object" && code !== null ? String(code.value) : code?.toString();
    return subjectFromDiagnostic(toDocument(document), relativePathOf(document.uri.toString()), {
      message: diagnostic.message,
      source: diagnostic.source,
      code: codeValue,
      startLine: diagnostic.range.start.line,
      startCharacter: diagnostic.range.start.character,
      endLine: diagnostic.range.end.line,
      endCharacter: diagnostic.range.end.character,
    });
  }
}

function lookupsFor(origin: vscode.TextDocument): SubjectLookups {
  return {
    wordAt: (uri, line, character) => {
      const document = origin.uri.toString() === uri ? origin : undefined;
      if (!document) return null;
      const position = new vscode.Position(line, character);
      const range = document.getWordRangeAtPosition(position);
      if (!range) return null;
      return {
        text: document.getText(range),
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
      };
    },
    definitions: async (uri, line, character) => {
      try {
        const definitions = await vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >(
          "vscode.executeDefinitionProvider",
          vscode.Uri.parse(uri),
          new vscode.Position(line, character),
        );
        return (definitions ?? []).map(toDefinition);
      } catch {
        return [];
      }
    },
    openDocument: async (uri) => {
      if (origin.uri.toString() === uri) return toDocument(origin);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      return toDocument(document);
    },
    outline: async (uri) => {
      try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          vscode.Uri.parse(uri),
        );
        return (symbols ?? []).map(toOutline);
      } catch {
        return [];
      }
    },
    relativePath: relativePathOf,
  };
}

function toDocument(document: vscode.TextDocument): SubjectDocument {
  return {
    uri: document.uri.toString(),
    languageId: document.languageId,
    lineCount: document.lineCount,
    lineAt: (line) => document.lineAt(line).text,
  };
}

function toDefinition(def: vscode.Location | vscode.LocationLink): DefinitionSpan {
  if ("targetUri" in def) {
    const range = def.targetSelectionRange || def.targetRange;
    return {
      uri: def.targetUri.toString(),
      startLine: range.start.line,
      startCharacter: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character,
    };
  }
  return {
    uri: def.uri.toString(),
    startLine: def.range.start.line,
    startCharacter: def.range.start.character,
    endLine: def.range.end.line,
    endCharacter: def.range.end.character,
  };
}

function toOutline(symbol: vscode.DocumentSymbol): OutlineSymbol {
  return {
    kind: vscode.SymbolKind[symbol.kind] ?? "Symbol",
    startLine: symbol.range.start.line,
    startCharacter: symbol.range.start.character,
    endLine: symbol.range.end.line,
    endCharacter: symbol.range.end.character,
    children: (symbol.children ?? []).map(toOutline),
  };
}

function relativePathOf(uri: string): string {
  const parsed = vscode.Uri.parse(uri);
  const folder = vscode.workspace.getWorkspaceFolder(parsed);
  return folder ? path.relative(folder.uri.fsPath, parsed.fsPath) : path.basename(parsed.fsPath);
}
