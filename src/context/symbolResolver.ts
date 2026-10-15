import * as path from "node:path";
import * as vscode from "vscode";
import type { DeepWikiSymbol, SymbolRange } from "../types";

export class SymbolResolver {
  public static async resolveSymbolAtCursor(
    editor: vscode.TextEditor,
    explicitPosition?: vscode.Position,
  ): Promise<DeepWikiSymbol | null> {
    const document = editor.document;
    const position = explicitPosition || editor.selection.active;

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }

    const symbolName = document.getText(wordRange);
    let targetUri = document.uri;
    let targetRange = wordRange;
    let symbolKind = "Symbol";

    // 1. Try definition provider to jump to the actual definition if cursor is on a usage
    try {
      const definitions = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >("vscode.executeDefinitionProvider", document.uri, position);

      if (definitions && definitions.length > 0) {
        const firstDef = definitions[0];
        if ("targetUri" in firstDef) {
          targetUri = firstDef.targetUri;
          targetRange = firstDef.targetSelectionRange || firstDef.targetRange;
        } else if ("uri" in firstDef) {
          targetUri = firstDef.uri;
          targetRange = firstDef.range;
        }
      }
    } catch (_err) {
      // Fall back to current document
    }

    // 2. Fetch Document Symbols for the target document to identify exact symbol kind and scope
    let targetDoc: vscode.TextDocument;
    try {
      targetDoc = await vscode.workspace.openTextDocument(targetUri);
    } catch {
      targetDoc = document;
      targetUri = document.uri;
    }

    let enclosingRange: vscode.Range = targetRange;
    try {
      const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        targetUri,
      );

      if (docSymbols && docSymbols.length > 0) {
        const match = this.findMatchingSymbol(docSymbols, targetRange.start);
        if (match) {
          symbolKind = this.formatSymbolKind(match.kind);
          enclosingRange = match.range;
        }
      }
    } catch (_err) {
      // Ignored
    }

    // 3. Fallback heuristic for symbol kind if still "Symbol"
    if (symbolKind === "Symbol") {
      const lineText = targetDoc.lineAt(targetRange.start.line).text;
      if (/\b(function|def|fn|func)\b/i.test(lineText)) {
        symbolKind = "Function";
      } else if (/\b(class|struct)\b/i.test(lineText)) {
        symbolKind = "Class";
      } else if (/\b(interface|trait|type)\b/i.test(lineText)) {
        symbolKind = "Interface";
      } else if (/\b(enum)\b/i.test(lineText)) {
        symbolKind = "Enum";
      } else if (/\b(const|let|var|val)\b/i.test(lineText)) {
        symbolKind = "Variable";
      }
    }

    // 4. Extract enclosing code context (bounded to max 120 lines around symbol)
    const startLine = Math.max(0, enclosingRange.start.line - 10);
    const endLine = Math.min(
      targetDoc.lineCount - 1,
      Math.max(enclosingRange.end.line + 10, startLine + 80),
    );

    const contextLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const prefix = i === targetRange.start.line ? "> " : "  ";
      contextLines.push(`${prefix}${i + 1}: ${targetDoc.lineAt(i).text}`);
    }

    const enclosingCode = contextLines.join("\n");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, targetUri.fsPath)
      : path.basename(targetUri.fsPath);

    const selectionRange: SymbolRange = {
      startLine: targetRange.start.line + 1,
      startColumn: targetRange.start.character + 1,
      endLine: targetRange.end.line + 1,
      endColumn: targetRange.end.character + 1,
    };

    return {
      name: symbolName,
      kind: symbolKind,
      uri: targetUri.toString(),
      relativePath,
      selectionRange,
      enclosingCode,
      languageId: targetDoc.languageId,
    };
  }

  private static findMatchingSymbol(
    symbols: vscode.DocumentSymbol[],
    pos: vscode.Position,
  ): vscode.DocumentSymbol | null {
    for (const sym of symbols) {
      if (sym.range.contains(pos)) {
        if (sym.children && sym.children.length > 0) {
          const childMatch = this.findMatchingSymbol(sym.children, pos);
          if (childMatch) {
            return childMatch;
          }
        }
        return sym;
      }
    }
    return null;
  }

  private static formatSymbolKind(kind: vscode.SymbolKind): string {
    switch (kind) {
      case vscode.SymbolKind.File:
        return "File";
      case vscode.SymbolKind.Module:
        return "Module";
      case vscode.SymbolKind.Namespace:
        return "Namespace";
      case vscode.SymbolKind.Package:
        return "Package";
      case vscode.SymbolKind.Class:
        return "Class";
      case vscode.SymbolKind.Method:
        return "Method";
      case vscode.SymbolKind.Property:
        return "Property";
      case vscode.SymbolKind.Field:
        return "Field";
      case vscode.SymbolKind.Constructor:
        return "Constructor";
      case vscode.SymbolKind.Enum:
        return "Enum";
      case vscode.SymbolKind.Interface:
        return "Interface";
      case vscode.SymbolKind.Function:
        return "Function";
      case vscode.SymbolKind.Variable:
        return "Variable";
      case vscode.SymbolKind.Constant:
        return "Constant";
      case vscode.SymbolKind.String:
        return "String";
      case vscode.SymbolKind.Number:
        return "Number";
      case vscode.SymbolKind.Boolean:
        return "Boolean";
      case vscode.SymbolKind.Array:
        return "Array";
      case vscode.SymbolKind.Object:
        return "Object";
      case vscode.SymbolKind.Key:
        return "Key";
      case vscode.SymbolKind.Null:
        return "Null";
      case vscode.SymbolKind.EnumMember:
        return "EnumMember";
      case vscode.SymbolKind.Struct:
        return "Struct";
      case vscode.SymbolKind.Event:
        return "Event";
      case vscode.SymbolKind.Operator:
        return "Operator";
      case vscode.SymbolKind.TypeParameter:
        return "TypeParameter";
      default:
        return "Symbol";
    }
  }
}
