import * as vscode from "vscode";
import type { DeepWikiSymbol } from "../types";
import type { DeepWikiViewProvider } from "../webview/wikiViewProvider";

export class DiagnosticQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const diagnostics = context.diagnostics;
    if (!diagnostics || diagnostics.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // If there are multiple diagnostics at cursor, offer an aggregate action first
    if (diagnostics.length > 1) {
      const allAction = new vscode.CodeAction(
        `💬 Ask Hermes Studio to fix all ${diagnostics.length} problems here`,
        vscode.CodeActionKind.QuickFix,
      );
      allAction.command = {
        command: "deepwiki.askHermesDiagnostic",
        title: "Ask Hermes Studio to fix all problems",
        arguments: [document, diagnostics],
      };
      actions.push(allAction);
    }

    // Individual action for each diagnostic
    for (const diag of diagnostics) {
      const label = diag.message.length > 55 ? `${diag.message.slice(0, 52)}...` : diag.message;

      // 1. Ask Hermes Studio
      const hermesAction = new vscode.CodeAction(
        `💬 Ask Hermes Studio to fix: "${label}"`,
        vscode.CodeActionKind.QuickFix,
      );
      hermesAction.command = {
        command: "deepwiki.askHermesDiagnostic",
        title: "Ask Hermes Studio",
        arguments: [document, [diag]],
      };
      actions.push(hermesAction);

      // 2. Explain in DeepWiki
      const wikiAction = new vscode.CodeAction(
        `📖 Explain in DeepWiki: "${label}"`,
        vscode.CodeActionKind.QuickFix,
      );
      wikiAction.command = {
        command: "deepwiki.explainDiagnosticInDeepWiki",
        title: "Explain in DeepWiki",
        arguments: [document, diag],
      };
      actions.push(wikiAction);
    }

    return actions;
  }
}

export function formatDiagnosticsPrompt(
  document: vscode.TextDocument,
  diagnostics: vscode.Diagnostic[],
): string {
  const relPath = vscode.workspace.asRelativePath(document.uri);
  const firstDiag = diagnostics[0];
  const startLine = firstDiag.range.start.line + 1;

  // Extract surrounding code context: 6 lines before and 6 lines after
  const totalLines = document.lineCount;
  const minLine = Math.min(...diagnostics.map((d) => d.range.start.line));
  const maxLine = Math.max(...diagnostics.map((d) => d.range.end.line));

  const ctxStartLine = Math.max(0, minLine - 6);
  const ctxEndLine = Math.min(totalLines - 1, maxLine + 6);

  const contextLines: string[] = [];
  for (let i = ctxStartLine; i <= ctxEndLine; i++) {
    const lineText = document.lineAt(i).text;
    const lineNum = (i + 1).toString().padStart(4, " ");
    const isErrorLine = diagnostics.some((d) => i >= d.range.start.line && i <= d.range.end.line);
    const marker = isErrorLine ? ">" : " ";
    contextLines.push(`${marker} ${lineNum} | ${lineText}`);
  }

  const codeSnippet = contextLines.join("\n");

  if (diagnostics.length === 1) {
    const diag = firstDiag;
    const severity = getSeverityLabel(diag.severity);
    const sourceInfo = diag.source ? `[${diag.source}] ` : "";
    const codeInfo = diag.code
      ? typeof diag.code === "object"
        ? `(${diag.code.value}) `
        : `(${diag.code}) `
      : "";

    return `Please help me understand and fix this linting/compiler problem in \`${relPath}\`:

**Problem:** ${sourceInfo}${codeInfo}${diag.message}
**Location:** Line ${startLine}:${diag.range.start.character + 1}
**Severity:** ${severity}

**Code Context:**
\`\`\`${document.languageId}
${codeSnippet}
\`\`\`

Please explain what caused this issue and provide the corrected code.`;
  }

  // Multiple diagnostics
  const diagList = diagnostics
    .map((d, index) => {
      const severity = getSeverityLabel(d.severity);
      const sourceInfo = d.source ? `[${d.source}] ` : "";
      const codeInfo = d.code
        ? typeof d.code === "object"
          ? `(${d.code.value}) `
          : `(${d.code}) `
        : "";
      return `${index + 1}. **Line ${d.range.start.line + 1}** (${severity}): ${sourceInfo}${codeInfo}${d.message}`;
    })
    .join("\n");

  return `Please help me fix the following ${diagnostics.length} linting/compiler problems in \`${relPath}\` around line ${startLine}:

${diagList}

**Code Context:**
\`\`\`${document.languageId}
${codeSnippet}
\`\`\`

Please explain each problem and provide the corrected code to fix them.`;
}

function getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "Error";
    case vscode.DiagnosticSeverity.Warning:
      return "Warning";
    case vscode.DiagnosticSeverity.Information:
      return "Information";
    case vscode.DiagnosticSeverity.Hint:
      return "Hint";
  }
}

export function registerDiagnosticCommands(
  context: vscode.ExtensionContext,
  provider: DeepWikiViewProvider,
): void {
  // 1. Command to Ask Hermes Studio
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "deepwiki.askHermesDiagnostic",
      async (
        document: vscode.TextDocument,
        diagnosticsArg: vscode.Diagnostic | vscode.Diagnostic[],
      ) => {
        const diagnostics = Array.isArray(diagnosticsArg) ? diagnosticsArg : [diagnosticsArg];
        if (!document || diagnostics.length === 0) return;

        const promptText = formatDiagnosticsPrompt(document, diagnostics);

        // Copy formatted problem and context to clipboard
        await vscode.env.clipboard.writeText(promptText);

        const hermesExt = vscode.extensions.getExtension("jefuriiij.hermes-studio");
        if (hermesExt) {
          if (!hermesExt.isActive) {
            await hermesExt.activate();
          }

          // Open or create new chat in Hermes Studio
          try {
            await vscode.commands.executeCommand("hermesStudio.newChat");
          } catch {
            await vscode.commands.executeCommand("hermesStudio.openChat");
          }

          // Attempt clipboard paste action after chat panel reveals
          setTimeout(async () => {
            try {
              await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
            } catch {
              // Ignore if webview doesn't accept active editor paste command
            }
          }, 250);

          vscode.window.showInformationMessage(
            "Hermes Studio opened. Problem context copied to clipboard (press Ctrl+V to paste).",
          );
        } else {
          vscode.window.showWarningMessage(
            "Hermes Studio extension is not installed or active. Problem context copied to clipboard.",
          );
        }
      },
    ),
  );

  // 2. Command to Explain in DeepWiki
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "deepwiki.explainDiagnosticInDeepWiki",
      async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
        if (!document || !diagnostic) return;

        const relPath = vscode.workspace.asRelativePath(document.uri);
        const startLine = diagnostic.range.start.line + 1;
        const totalLines = document.lineCount;
        const ctxStartLine = Math.max(0, diagnostic.range.start.line - 8);
        const ctxEndLine = Math.min(totalLines - 1, diagnostic.range.end.line + 8);

        const sourceTitle = diagnostic.source
          ? `${diagnostic.source}: ${diagnostic.code ? (typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code) : "Diagnostic"}`
          : "Linting Problem";

        const enclosingCode = document.getText(
          new vscode.Range(ctxStartLine, 0, ctxEndLine, document.lineAt(ctxEndLine).text.length),
        );

        const diagnosticSymbol: DeepWikiSymbol = {
          name: sourceTitle,
          kind: "Diagnostic",
          uri: document.uri.toString(),
          relativePath: relPath,
          selectionRange: {
            startLine,
            startColumn: diagnostic.range.start.character + 1,
            endLine: diagnostic.range.end.line + 1,
            endColumn: diagnostic.range.end.character + 1,
          },
          enclosingCode: `// Diagnostic: ${diagnostic.message}\n\n${enclosingCode}`,
          languageId: document.languageId,
        };

        await provider.loadSymbol(diagnosticSymbol);
      },
    ),
  );
}
