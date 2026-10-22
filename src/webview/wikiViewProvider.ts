import * as vscode from "vscode";
import { sendPromptToHermes } from "../hermes/hermesHandoff";
import { AIProviderFactory } from "../providers/aiProvider";
import { ArticleSession } from "../session/articleSession";
import type {
  DeepWikiSymbol,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../types";
import { getDeepWikiWebviewContent } from "./deepwikiHtml";

const wikiHermesMessages = {
  opened: "Opened new chat in Hermes Studio. Question context copied to clipboard.",
  notInstalled: "Hermes Studio extension is not installed or active. Context copied to clipboard.",
};

export class DeepWikiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "deepwiki.wikiView";

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private readonly _session: ArticleSession;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._session = new ArticleSession({
      createProvider: () => AIProviderFactory.createProvider(),
      emit: (message) => this.postToAllWebviews(message),
      getFollowupAction: () =>
        vscode.workspace.getConfiguration("deepwiki").get<string>("followupAction", "inline"),
      writeClipboard: (text) => vscode.env.clipboard.writeText(text),
      sendToHermes: async (promptText) => {
        await sendPromptToHermes(promptText, wikiHermesMessages);
      },
      warn: (message) => {
        vscode.window.showWarningMessage(message);
      },
      info: (message) => {
        vscode.window.showInformationMessage(message);
      },
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "media")],
    };

    webviewView.webview.html = getDeepWikiWebviewContent(webviewView.webview, this._extensionUri);

    this.setupMessageListener(webviewView.webview);

    this._session.restore();
  }

  public openInEditorTab(): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "deepwiki.editorTab",
      "DeepWiki",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "media")],
      },
    );

    this._panel.iconPath = vscode.Uri.joinPath(this._extensionUri, "media", "deepwiki.svg");

    this._panel.webview.html = getDeepWikiWebviewContent(this._panel.webview, this._extensionUri);

    this.setupMessageListener(this._panel.webview);

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._session.restore();
  }

  private setupMessageListener(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      switch (msg.type) {
        case "openFileLocation":
          await this.handleOpenFileLocation(msg.uri, msg.line, msg.column);
          break;
        case "openFileCitation":
          await this.handleOpenFileCitation(msg.path, msg.line);
          break;
        case "historyBack":
          this._session.navigateBack();
          break;
        case "historyForward":
          this._session.navigateForward();
          break;
        case "copyMarkdown":
          await vscode.env.clipboard.writeText(msg.markdown);
          vscode.window.showInformationMessage("DeepWiki markdown copied to clipboard.");
          break;
        case "refresh":
          await this.refreshCurrentArticle();
          break;
        case "followupClick":
        case "askCustomQuestion":
          await this._session.handleFollowup(msg.question, msg.qaId);
          break;
        case "openInHermes":
          await this._session.sendToHermes(msg.question, msg.answer);
          break;
      }
    });
  }

  public async loadSymbol(symbol: DeepWikiSymbol, pushHistory = true): Promise<void> {
    if (this._view) {
      this._view.show?.(true);
    } else {
      await vscode.commands.executeCommand("deepwiki.wikiView.focus");
    }

    await this._session.loadSymbol(symbol, pushHistory);
  }

  /** Regenerates the article on screen. Returns false when there is none. */
  public async refreshCurrentArticle(): Promise<boolean> {
    return this._session.refreshCurrentArticle();
  }

  private async handleOpenFileLocation(
    uriString: string,
    line: number,
    column: number = 1,
  ): Promise<void> {
    try {
      const uri = vscode.Uri.parse(uriString);
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        preview: false,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
    }
  }

  private async handleOpenFileCitation(citationPath: string, line: number): Promise<void> {
    try {
      let targetUri: vscode.Uri | undefined;
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          const candidate = vscode.Uri.joinPath(folder.uri, citationPath);
          try {
            await vscode.workspace.fs.stat(candidate);
            targetUri = candidate;
            break;
          } catch {
            // continue search
          }
        }
      }

      if (!targetUri) {
        // Try direct file path
        targetUri = vscode.Uri.file(citationPath);
      }

      const doc = await vscode.workspace.openTextDocument(targetUri);
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        preview: false,
      });
    } catch (_err: any) {
      vscode.window.showErrorMessage(`Could not find cited file: ${citationPath}`);
    }
  }

  private postToAllWebviews(message: ExtensionToWebviewMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
    if (this._panel) {
      this._panel.webview.postMessage(message);
    }
  }
}
