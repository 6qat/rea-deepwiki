import * as vscode from "vscode";
import { SymbolResolver } from "./context/symbolResolver";
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
      const editor = vscode.window.activeTextEditor;

      if (editor) {
        let explicitPos: vscode.Position | undefined;
        if (arg && typeof arg.lineNumber === "number" && typeof arg.column === "number") {
          explicitPos = new vscode.Position(arg.lineNumber - 1, arg.column - 1);
        }

        const symbol = await SymbolResolver.resolveSymbolAtCursor(editor, explicitPos);
        if (symbol) {
          await provider.loadSymbol(symbol);
          return;
        }
      }

      // If no cursor symbol could be identified, offer an input prompt
      const input = await vscode.window.showInputBox({
        prompt: "Enter a function, class, or symbol name to look up in DeepWiki",
        placeHolder: "e.g. handleRequest, AuthController, streamData",
      });

      if (input && input.trim()) {
        const fallbackSymbol = {
          name: input.trim(),
          kind: "Symbol",
          uri: editor ? editor.document.uri.toString() : "",
          relativePath: editor ? vscode.workspace.asRelativePath(editor.document.uri) : "",
          selectionRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          enclosingCode: editor ? editor.document.getText().slice(0, 3000) : "",
          languageId: editor ? editor.document.languageId : "plaintext",
        };
        await provider.loadSymbol(fallbackSymbol);
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
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const symbol = await SymbolResolver.resolveSymbolAtCursor(editor);
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
            JSON.stringify([{ lineNumber: position.line + 1, column: position.character + 1 }]),
          );
          const cmdUri = vscode.Uri.parse(`command:deepwiki.openSymbol?${args}`);

          const md = new vscode.MarkdownString(
            `[$(book) Read about **${word}** in DeepWiki](${cmdUri})`,
          );
          md.isTrusted = true;
          return new vscode.Hover(md, wordRange);
        },
      },
    ),
  );
}

export function deactivate() {}
