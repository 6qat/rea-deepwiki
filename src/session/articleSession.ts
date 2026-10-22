import type { DeepWikiArticle, DeepWikiSymbol, ExtensionToWebviewMessage } from "../types";

export interface ArticleStreamResult {
  fullMarkdown: string;
  followupQuestions: string[];
  modelType: string;
}

export interface QuestionStreamResult {
  fullMarkdown: string;
  modelType: string;
}

export type SessionStreamProvider = {
  streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<ArticleStreamResult>;

  streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<QuestionStreamResult>;
};

export type FollowupAction = "inline" | "hermes" | "deepwiki" | "clipboard";

export interface ArticleSessionDeps {
  createProvider(): SessionStreamProvider;
  emit(message: ExtensionToWebviewMessage): void;
  getFollowupAction(): string;
  writeClipboard(text: string): PromiseLike<void>;
  sendToHermes(promptText: string): Promise<void>;
  warn(message: string): void;
  info(message: string): void;
}

/**
 * Owns the article conversation: history, navigation, and the article and
 * follow-up streams. Knows nothing about VS Code or webviews; callers wire the
 * dependencies and receive every state change through `emit`.
 */
export class ArticleSession {
  private readonly _history: DeepWikiArticle[] = [];
  private _historyIndex = -1;
  private _currentAbortController?: AbortController;
  private _currentQaAbortController?: AbortController;

  private readonly deps: ArticleSessionDeps;

  constructor(deps: ArticleSessionDeps) {
    this.deps = deps;
  }

  public get currentArticle(): DeepWikiArticle | undefined {
    return this._historyIndex >= 0 ? this._history[this._historyIndex] : undefined;
  }

  public get canGoBack(): boolean {
    return this._historyIndex > 0;
  }

  public get canGoForward(): boolean {
    return this._historyIndex < this._history.length - 1;
  }

  /** Re-emits the article on screen, for a webview that just resolved. */
  public restore(): void {
    const article = this.currentArticle;
    if (!article) return;

    this.deps.emit({ type: "setSymbol", symbol: article.symbol });
    this.emitArticle(article);
    this.emitHistoryState();
  }

  public async loadSymbol(symbol: DeepWikiSymbol, pushHistory = true): Promise<void> {
    this._currentAbortController?.abort();
    this._currentAbortController = new AbortController();

    if (this._currentQaAbortController) {
      this._currentQaAbortController.abort();
      this._currentQaAbortController = undefined;
    }

    this.deps.emit({ type: "setSymbol", symbol });

    const signal = this._currentAbortController.signal;
    try {
      const provider = this.deps.createProvider();
      const result = await provider.streamArticle(
        symbol,
        (delta) => this.deps.emit({ type: "streamDelta", delta }),
        signal,
      );

      const article: DeepWikiArticle = {
        symbol,
        markdown: result.fullMarkdown,
        followupQuestions: result.followupQuestions,
        modelType: result.modelType,
        requestId: Date.now().toString(),
        qas: [],
      };

      if (pushHistory) {
        if (this._historyIndex < this._history.length - 1) {
          this._history.splice(this._historyIndex + 1);
        }
        this._history.push(article);
        this._historyIndex = this._history.length - 1;
      } else if (this._historyIndex >= 0) {
        // Refresh replaces the current entry; pushing would make Back a duplicate.
        this._history[this._historyIndex] = article;
      }

      this.emitArticle(article);
      this.emitHistoryState();
    } catch (err) {
      if (isAbort(err)) return;
      this.deps.emit({
        type: "streamError",
        message: messageOf(err, "Unknown error generating DeepWiki article."),
      });
    }
  }

  /** Regenerates the article on screen. Returns false when there is none. */
  public async refreshCurrentArticle(): Promise<boolean> {
    const current = this.currentArticle;
    if (!current) return false;
    await this.loadSymbol(current.symbol, false);
    return true;
  }

  public navigateBack(): void {
    if (!this.canGoBack) return;
    this._historyIndex--;
    this.emitCurrent();
  }

  public navigateForward(): void {
    if (!this.canGoForward) return;
    this._historyIndex++;
    this.emitCurrent();
  }

  public async handleFollowup(question: string, providedQaId?: string): Promise<void> {
    const current = this.currentArticle;
    if (!current) {
      this.deps.warn("No active symbol to ask questions about.");
      return;
    }

    const action = this.deps.getFollowupAction();

    if (action === "hermes") {
      await this.sendToHermes(question);
      return;
    }

    if (action === "deepwiki") {
      const questionSymbol: DeepWikiSymbol = {
        ...current.symbol,
        name: `${current.symbol.name} • ${question}`,
        kind: "Follow-up",
      };
      await this.loadSymbol(questionSymbol);
      return;
    }

    if (action === "clipboard") {
      const promptText = clipboardPrompt(current.symbol, question);
      await this.deps.writeClipboard(promptText);
      this.deps.info(`Copied question to clipboard: "${question}"`);
      return;
    }

    await this.streamAnswer(current, question, providedQaId);
  }

  /** Copies a composed prompt and hands it to Hermes. */
  public async sendToHermes(question: string, answer?: string): Promise<void> {
    const current = this.currentArticle;
    await this.deps.sendToHermes(
      current ? hermesPrompt(current.symbol, question, answer) : question,
    );
  }

  private async streamAnswer(
    current: DeepWikiArticle,
    question: string,
    providedQaId?: string,
  ): Promise<void> {
    const qaId = providedQaId || `qa-${Date.now().toString()}`;

    this._currentQaAbortController?.abort();
    this._currentQaAbortController = new AbortController();

    this.deps.emit({ type: "qaStreamStart", qaId, question });

    const signal = this._currentQaAbortController.signal;
    try {
      const provider = this.deps.createProvider();
      const result = await provider.streamQuestion(
        current.symbol,
        current.markdown,
        question,
        (delta) => this.deps.emit({ type: "qaStreamDelta", qaId, delta }),
        signal,
      );

      current.qas ??= [];
      current.qas.push({
        id: qaId,
        question,
        answerMarkdown: result.fullMarkdown,
        modelType: result.modelType,
      });

      this.deps.emit({
        type: "qaStreamComplete",
        qaId,
        fullMarkdown: result.fullMarkdown,
        modelType: result.modelType,
      });
    } catch (err) {
      if (isAbort(err)) return;
      this.deps.emit({
        type: "qaStreamError",
        qaId,
        message: messageOf(err, "Unknown error generating answer."),
      });
    }
  }

  private emitCurrent(): void {
    const article = this.currentArticle;
    if (!article) return;
    this.deps.emit({ type: "setSymbol", symbol: article.symbol });
    this.emitArticle(article);
    this.emitHistoryState();
  }

  private emitArticle(article: DeepWikiArticle): void {
    this.deps.emit({
      type: "streamComplete",
      fullMarkdown: article.markdown,
      followupQuestions: article.followupQuestions,
      modelType: article.modelType,
      qas: article.qas ?? [],
    });
  }

  private emitHistoryState(): void {
    this.deps.emit({
      type: "setHistoryState",
      hasBack: this.canGoBack,
      hasForward: this.canGoForward,
    });
  }
}

function symbolHeader(symbol: DeepWikiSymbol): string {
  return `Regarding \`${symbol.name}\` (${symbol.kind}) in \`${symbol.relativePath}\`:`;
}

function clipboardPrompt(symbol: DeepWikiSymbol, question: string): string {
  return `${symbolHeader(symbol)}\n${question}`;
}

function hermesPrompt(symbol: DeepWikiSymbol, question: string, answer?: string): string {
  const answerBlock = answer ? `\n\nDeepWiki Inline Answer:\n${answer}` : "";
  return `${symbolHeader(symbol)}\n\nQuestion: ${question}${answerBlock}`;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
