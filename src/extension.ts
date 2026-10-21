import * as vscode from "vscode";
import { SymbolResolver } from "./context/symbolResolver";
import {
  DiagnosticQuickFixProvider,
  registerDiagnosticCommands,
} from "./providers/diagnosticQuickFixProvider";
import { DeepWikiViewProvider } from "./webview/wikiViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const provider = new DeepWikiViewProvider(context.extensionUri);

  // Register the sidebar webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DeepWikiViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Command: Open Symbol in DeepWiki
  context.subscriptions.push(
    vscode.commands.registerCommand("deepwiki.openSymbol", async (arg?: any) => {
      // A hover link names its own document: the hovered editor is not always the focused one.
      const editor =
        vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === arg?.uri) ??
        vscode.window.activeTextEditor;

      if (editor) {
        const position =
          typeof arg?.lineNumber === "number" && typeof arg?.column === "number"
            ? new vscode.Position(arg.lineNumber - 1, arg.column - 1)
            : editor.selection.active;

        const symbol = await SymbolResolver.resolveSymbolAt(editor.document, position);
        if (symbol) {
          await provider.loadSymbol(symbol);
          return;
        }
      }

      // No symbol under the cursor: ask for a name and find its definition in the workspace.
      const input = await vscode.window.showInputBox({
        prompt: "Enter a function, class, or symbol name to look up in DeepWiki",
        placeHolder: "e.g. handleRequest, AuthController, streamData",
      });
      const name = input?.trim();
      if (!name) return;

      const hits =
        (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          "vscode.executeWorkspaceSymbolProvider",
          name,
        )) ?? [];
      const hit = hits.find((h) => h.name === name) ?? hits[0];
      if (!hit) {
        vscode.window.showWarningMessage(`No symbol named "${name}" found in the workspace.`);
        return;
      }

      const document = await vscode.workspace.openTextDocument(hit.location.uri);
      const symbol = await SymbolResolver.resolveSymbolAt(document, hit.location.range.start);
      if (symbol) {
        await provider.loadSymbol(symbol);
      }
    }),
  );

  // Command: Open in Editor Tab
  context.subscriptions.push(
    vscode.commands.registerCommand("deepwiki.openWikiTab", () => {
      provider.openInEditorTab();
    }),
  );

  // Command: Refresh Article
  context.subscriptions.push(
    vscode.commands.registerCommand("deepwiki.refresh", async () => {
      if (await provider.refreshCurrentArticle()) return;
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const symbol = await SymbolResolver.resolveSymbolAt(
          editor.document,
          editor.selection.active,
        );
        if (symbol) {
          await provider.loadSymbol(symbol);
        }
      }
    }),
  );

  // Hover Provider (optional tooltip integration)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      {
        provideHover(document, position) {
          const wordRange = document.getWordRangeAtPosition(position);
          if (!wordRange) return undefined;

          const word = document.getText(wordRange);
          if (word.length < 3) return undefined;

          const args = encodeURIComponent(
            JSON.stringify([
              {
                uri: document.uri.toString(),
                lineNumber: position.line + 1,
                column: position.character + 1,
              },
            ]),
          );
          const cmdUri = vscode.Uri.parse(`command:deepwiki.openSymbol?${args}`);

          const md = new vscode.MarkdownString(
            `[$(book) Read about **${word}** in DeepWiki](${cmdUri})`,
          );
          md.isTrusted = { enabledCommands: ["deepwiki.openSymbol"] };
          return new vscode.Hover(md, wordRange);
        },
      },
    ),
  );

  // Diagnostic Quick Fix Provider (Ask Hermes Studio / Explain in DeepWiki)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      new DiagnosticQuickFixProvider(),
      {
        providedCodeActionKinds: DiagnosticQuickFixProvider.providedCodeActionKinds,
      },
    ),
  );

  // Register commands for diagnostic quick fixes
  registerDiagnosticCommands(context, provider);
}

export function deactivate() {}
