import * as vscode from "vscode";
import { AIProviderFactory } from "../providers/aiProvider";
import type { DeepWikiArticle, DeepWikiSymbol, WebviewToExtensionMessage } from "../types";
import { getDeepWikiWebviewContent } from "./deepwikiHtml";

export class DeepWikiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "deepwiki.wikiView";

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private _history: DeepWikiArticle[] = [];
  private _historyIndex: number = -1;
  private _currentAbortController?: AbortController;
  private _currentQaAbortController?: AbortController;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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

    // If there is existing history, restore latest entry
    if (this._historyIndex >= 0 && this._history[this._historyIndex]) {
      this.displayArticle(this._history[this._historyIndex], false);
    }
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

    if (this._historyIndex >= 0 && this._history[this._historyIndex]) {
      this.displayArticle(this._history[this._historyIndex], false);
    }
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
          this.navigateBack();
          break;
        case "historyForward":
          this.navigateForward();
          break;
        case "copyMarkdown":
          await vscode.env.clipboard.writeText(msg.markdown);
          vscode.window.showInformationMessage("DeepWiki markdown copied to clipboard.");
          break;
        case "refresh":
          await this.refreshCurrentArticle();
          break;
        case "followupClick":
          await this.handleFollowupClick(msg.question, msg.qaId);
          break;
        case "askCustomQuestion":
          await this.handleFollowupClick(msg.question, msg.qaId);
          break;
        case "openInHermes":
          await this.handleOpenInHermes(msg.question, msg.answer);
          break;
      }
    });
  }

  public async loadSymbol(symbol: DeepWikiSymbol, pushHistory = true): Promise<void> {
    // Reveal view
    if (this._view) {
      this._view.show?.(true);
    } else {
      await vscode.commands.executeCommand("deepwiki.wikiView.focus");
    }

    // Cancel in-flight generation if any
    if (this._currentAbortController) {
      this._currentAbortController.abort();
    }
    this._currentAbortController = new AbortController();

    if (this._currentQaAbortController) {
      this._currentQaAbortController.abort();
      this._currentQaAbortController = undefined;
    }

    this.postToAllWebviews({
      type: "setSymbol",
      symbol,
    });

    const provider = AIProviderFactory.createProvider();
    try {
      const result = await provider.streamArticle(
        symbol,
        (delta) => {
          this.postToAllWebviews({
            type: "streamDelta",
            delta,
          });
        },
        this._currentAbortController.signal,
      );

      const article: DeepWikiArticle = {
        symbol,
        markdown: result.fullMarkdown,
        followupQuestions: result.followupQuestions,
        modelType: result.modelType,
        requestId: Date.now().toString(),
        qas: [],
      };

      // Push to history
      if (pushHistory) {
        if (this._historyIndex < this._history.length - 1) {
          this._history = this._history.slice(0, this._historyIndex + 1);
        }
        this._history.push(article);
        this._historyIndex = this._history.length - 1;
      } else if (this._historyIndex >= 0) {
        // Refresh replaces the current entry; pushing would make Back a duplicate.
        this._history[this._historyIndex] = article;
      }

      this.displayArticle(article, true);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      this.postToAllWebviews({
        type: "streamError",
        message: err.message || "Unknown error generating DeepWiki article.",
      });
    }
  }

  private displayArticle(article: DeepWikiArticle, isNew: boolean): void {
    if (!isNew) {
      this.postToAllWebviews({
        type: "setSymbol",
        symbol: article.symbol,
      });
    }

    this.postToAllWebviews({
      type: "streamComplete",
      fullMarkdown: article.markdown,
      followupQuestions: article.followupQuestions,
      modelType: article.modelType,
      qas: article.qas || [],
    });

    this.updateHistoryButtons();
  }

  private navigateBack(): void {
    if (this._historyIndex > 0) {
      this._historyIndex--;
      this.displayArticle(this._history[this._historyIndex], false);
    }
  }

  private navigateForward(): void {
    if (this._historyIndex < this._history.length - 1) {
      this._historyIndex++;
      this.displayArticle(this._history[this._historyIndex], false);
    }
  }

  private updateHistoryButtons(): void {
    const hasBack = this._historyIndex > 0;
    const hasForward = this._historyIndex < this._history.length - 1;
    this.postToAllWebviews({
      type: "setHistoryState",
      hasBack,
      hasForward,
    });
  }

  /** Regenerates the article on screen. Returns false when there is none. */
  public async refreshCurrentArticle(): Promise<boolean> {
    const current = this._history[this._historyIndex];
    if (!current) return false;
    await this.loadSymbol(current.symbol, false);
    return true;
  }

  private async handleFollowupClick(question: string, providedQaId?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const followupAction = config.get<string>("followupAction", "inline");
    const current = this._historyIndex >= 0 ? this._history[this._historyIndex] : undefined;

    if (!current) {
      vscode.window.showWarningMessage("No active symbol to ask questions about.");
      return;
    }

    if (followupAction === "hermes") {
      await this.handleOpenInHermes(question);
      return;
    }

    if (followupAction === "deepwiki") {
      const questionSymbol: DeepWikiSymbol = {
        ...current.symbol,
        name: `${current.symbol.name} • ${question}`,
        kind: "Follow-up",
      };
      await this.loadSymbol(questionSymbol);
      return;
    }

    if (followupAction === "clipboard") {
      const promptText = `Regarding \`${current.symbol.name}\` (${current.symbol.kind}) in \`${current.symbol.relativePath}\`:\n${question}`;
      await vscode.env.clipboard.writeText(promptText);
      vscode.window.showInformationMessage(`Copied question to clipboard: "${question}"`);
      return;
    }

    // Default: 'inline' - Stream inline answer directly beneath Explore Further
    const qaId = providedQaId || "qa-" + Date.now().toString();

    // Cancel in-flight QA generation if any
    if (this._currentQaAbortController) {
      this._currentQaAbortController.abort();
    }
    this._currentQaAbortController = new AbortController();

    this.postToAllWebviews({
      type: "qaStreamStart",
      qaId,
      question,
    });

    const provider = AIProviderFactory.createProvider();
    try {
      const result = await provider.streamQuestion(
        current.symbol,
        current.markdown,
        question,
        (delta) => {
          this.postToAllWebviews({
            type: "qaStreamDelta",
            qaId,
            delta,
          });
        },
        this._currentQaAbortController.signal,
      );

      if (!current.qas) {
        current.qas = [];
      }
      current.qas.push({
        id: qaId,
        question,
        answerMarkdown: result.fullMarkdown,
        modelType: result.modelType,
      });

      this.postToAllWebviews({
        type: "qaStreamComplete",
        qaId,
        fullMarkdown: result.fullMarkdown,
        modelType: result.modelType,
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      this.postToAllWebviews({
        type: "qaStreamError",
        qaId,
        message: err.message || "Unknown error generating answer.",
      });
    }
  }

  private async handleOpenInHermes(question: string, answer?: string): Promise<void> {
    const current = this._historyIndex >= 0 ? this._history[this._historyIndex] : undefined;

    const promptText = current
      ? `Regarding \`${current.symbol.name}\` (${current.symbol.kind}) in \`${current.symbol.relativePath}\`:\n\nQuestion: ${question}${
          answer ? `\n\nDeepWiki Inline Answer:\n${answer}` : ""
        }`
      : question;

    await vscode.env.clipboard.writeText(promptText);

    const hermesExt = vscode.extensions.getExtension("jefuriiij.hermes-studio");
    if (hermesExt) {
      if (!hermesExt.isActive) {
        await hermesExt.activate();
      }
      try {
        await vscode.commands.executeCommand("hermesStudio.newChat");
      } catch {
        await vscode.commands.executeCommand("hermesStudio.openChat");
      }
      vscode.window.showInformationMessage(
        `Opened new chat in Hermes Studio. Question context copied to clipboard.`,
      );
    } else {
      vscode.window.showWarningMessage(
        "Hermes Studio extension is not installed or active. Context copied to clipboard.",
      );
    }
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
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not find cited file: ${citationPath}`);
    }
  }

  private postToAllWebviews(message: any): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
    if (this._panel) {
      this._panel.webview.postMessage(message);
    }
  }
}
