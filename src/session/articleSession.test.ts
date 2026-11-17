import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepWikiSymbol, ExtensionToWebviewMessage } from "../types.ts";
import {
  ArticleSession,
  type ArticleSessionDeps,
  type ArticleStreamResult,
  type QuestionStreamResult,
  type SessionStreamProvider,
} from "./articleSession.ts";

class FakeProvider implements SessionStreamProvider {
  articleResult: ArticleStreamResult = {
    fullMarkdown: "article",
    followupQuestions: ["Q1"],
    modelType: "fake",
  };
  questionResult: QuestionStreamResult = { fullMarkdown: "answer", modelType: "fake" };
  articleError?: unknown;
  questionError?: unknown;
  articleCalls = 0;

  async streamArticle(
    _symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    _abortSignal?: AbortSignal,
  ): Promise<ArticleStreamResult> {
    this.articleCalls++;
    if (this.articleError) throw this.articleError;
    onDelta("chunk");
    return this.articleResult;
  }

  async streamQuestion(
    _symbol: DeepWikiSymbol,
    _articleMarkdown: string,
    _question: string,
    onDelta: (delta: string) => void,
    _abortSignal?: AbortSignal,
  ): Promise<QuestionStreamResult> {
    if (this.questionError) throw this.questionError;
    onDelta("part");
    return this.questionResult;
  }
}

const sym = (name: string): DeepWikiSymbol => ({
  name,
  kind: "Function",
  uri: `file:///src/${name}.ts`,
  relativePath: `src/${name}.ts`,
  selectionRange: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
  enclosingCode: "code",
  languageId: "typescript",
});

function harness(overrides: Partial<ArticleSessionDeps> = {}) {
  const provider = new FakeProvider();
  const events: ExtensionToWebviewMessage[] = [];
  const calls = {
    clipboard: [] as string[],
    hermes: [] as string[],
    warnings: [] as string[],
    infos: [] as string[],
  };

  const deps: ArticleSessionDeps = {
    createProvider: () => provider,
    emit: (message) => events.push(message),
    getFollowupAction: () => "inline",
    writeClipboard: async (text) => {
      calls.clipboard.push(text);
    },
    sendToHermes: async (text) => {
      calls.hermes.push(text);
    },
    warn: (message) => {
      calls.warnings.push(message);
    },
    info: (message) => {
      calls.infos.push(message);
    },
    getModel: () => provider.articleResult.modelType,
    ...overrides,
  };

  return { session: new ArticleSession(deps), provider, events, calls };
}

const types = (events: ExtensionToWebviewMessage[]) => events.map((event) => event.type);

test("loadSymbol streams and emits a completed article", async () => {
  const { session, events } = harness();
  await session.loadSymbol(sym("alpha"));

  assert.deepEqual(types(events), [
    "setSymbol",
    "streamDelta",
    "streamComplete",
    "setHistoryState",
  ]);
  assert.equal(session.currentArticle?.symbol.name, "alpha");
  assert.equal(session.currentArticle?.markdown, "article");
  assert.equal(session.canGoBack, false);
});

test("the same term and model reopens the saved article", async () => {
  const { session, provider } = harness();
  provider.articleResult = {
    fullMarkdown: "from-llama",
    followupQuestions: [],
    modelType: "llama3.2",
  };
  await session.loadSymbol(sym("alpha"));

  provider.articleResult = {
    fullMarkdown: "should-not-run",
    followupQuestions: [],
    modelType: "llama3.2",
  };
  await session.loadSymbol(sym("alpha"));

  assert.equal(provider.articleCalls, 1);
  assert.equal(session.currentArticle?.markdown, "from-llama");
  assert.equal(session.canGoBack, false);

  const elsewhere = { ...sym("alpha"), uri: "file:///src/other.ts", relativePath: "src/other.ts" };
  await session.loadSymbol(elsewhere);
  assert.equal(provider.articleCalls, 2);
  assert.equal(session.currentArticle?.symbol.uri, elsewhere.uri);
});

test("the same symbol with two models stays as two labeled history steps", async () => {
  const { session, provider, events } = harness();
  provider.articleResult = {
    fullMarkdown: "from-llama",
    followupQuestions: [],
    modelType: "llama3.2",
  };
  await session.loadSymbol(sym("alpha"));

  provider.articleResult = {
    fullMarkdown: "from-gpt",
    followupQuestions: [],
    modelType: "gpt-4o",
  };
  await session.loadSymbol(sym("alpha"));

  assert.equal(session.canGoBack, true);
  assert.equal(session.currentArticle?.modelType, "gpt-4o");
  assert.equal(session.currentArticle?.markdown, "from-gpt");

  const latest = [...events].reverse().find((event) => event.type === "setHistoryState");
  assert.equal(latest?.type === "setHistoryState" && latest.index, 1);
  assert.deepEqual(latest?.type === "setHistoryState" && latest.entries, [
    { name: "alpha", model: "llama3.2" },
    { name: "alpha", model: "gpt-4o" },
  ]);

  events.length = 0;
  session.navigateTo(0);

  assert.equal(session.currentArticle?.modelType, "llama3.2");
  assert.equal(session.currentArticle?.markdown, "from-llama");
  const complete = events.find((event) => event.type === "streamComplete");
  assert.equal(complete?.type === "streamComplete" && complete.modelType, "llama3.2");
  const history = events.find((event) => event.type === "setHistoryState");
  assert.equal(history?.type === "setHistoryState" && history.index, 0);
  assert.equal(history?.type === "setHistoryState" && history.entries[1]?.model, "gpt-4o");

  session.navigateTo(0);
  session.navigateTo(9);
  assert.equal(session.currentArticle?.modelType, "llama3.2");
});

test("navigation walks the history and re-emits the article", async () => {
  const { session, events } = harness();
  await session.loadSymbol(sym("alpha"));
  await session.loadSymbol(sym("beta"));

  assert.equal(session.canGoBack, true);

  events.length = 0;
  session.navigateBack();

  assert.equal(session.currentArticle?.symbol.name, "alpha");
  const complete = events.find((event) => event.type === "streamComplete");
  assert.equal(complete?.type === "streamComplete" && complete.fullMarkdown, "article");
  assert.equal(session.canGoForward, true);
});

test("refresh replaces the current entry instead of pushing a duplicate", async () => {
  const { session } = harness();
  await session.loadSymbol(sym("alpha"));
  await session.refreshCurrentArticle();

  assert.equal(session.canGoBack, false);
  assert.equal(session.canGoForward, false);
  assert.equal(session.currentArticle?.symbol.name, "alpha");
});

test("a new symbol after navigating back drops the forward entries", async () => {
  const { session } = harness();
  await session.loadSymbol(sym("alpha"));
  await session.loadSymbol(sym("beta"));
  session.navigateBack();
  await session.loadSymbol(sym("gamma"));

  assert.equal(session.canGoForward, false);
  assert.equal(session.currentArticle?.symbol.name, "gamma");
});

test("an aborted article stream stays silent", async () => {
  const { session, provider, events } = harness();
  provider.articleError = Object.assign(new Error("aborted"), { name: "AbortError" });

  await session.loadSymbol(sym("alpha"));

  assert.equal(
    events.some((event) => event.type === "streamError"),
    false,
  );
  assert.equal(session.currentArticle, undefined);
});

test("a failing article stream reports the error", async () => {
  const { session, provider, events } = harness();
  provider.articleError = new Error("boom");

  await session.loadSymbol(sym("alpha"));

  const error = events.find((event) => event.type === "streamError");
  assert.equal(error?.type === "streamError" && error.message, "boom");
});

test("a follow-up answer uses the article model, not the configured one", async () => {
  const models: Array<string | undefined> = [];
  const { session, provider } = harness({
    getModel: () => "settings-model",
    createProvider: (model) => {
      models.push(model);
      return provider;
    },
  });
  provider.articleResult = {
    fullMarkdown: "from-llama",
    followupQuestions: [],
    modelType: "llama3.2",
  };

  await session.loadSymbol(sym("alpha"));
  await session.handleFollowup("why?");

  assert.deepEqual(models, [undefined, "llama3.2"]);
});

test("a deepwiki follow-up article is generated with the article model", async () => {
  const models: Array<string | undefined> = [];
  const { session, provider } = harness({
    getFollowupAction: () => "deepwiki",
    getModel: () => "settings-model",
    createProvider: (model) => {
      models.push(model);
      return provider;
    },
  });
  provider.articleResult = {
    fullMarkdown: "from-llama",
    followupQuestions: [],
    modelType: "llama3.2",
  };

  await session.loadSymbol(sym("alpha"));
  await session.handleFollowup("why?");

  assert.deepEqual(models, [undefined, "llama3.2"]);
  assert.equal(session.currentArticle?.symbol.name, "alpha • why?");
});

test("inline follow-up streams an answer and records it on the article", async () => {
  const { session, events } = harness();
  await session.loadSymbol(sym("alpha"));

  events.length = 0;
  await session.handleFollowup("why?", "qa-1");

  assert.deepEqual(types(events), ["qaStreamStart", "qaStreamDelta", "qaStreamComplete"]);
  const start = events[0];
  assert.equal(start.type === "qaStreamStart" && start.qaId, "qa-1");
  assert.equal(session.currentArticle?.qas?.length, 1);
  assert.equal(session.currentArticle?.qas?.[0].answerMarkdown, "answer");
});

test("an aborted answer stream stays silent", async () => {
  const { session, provider, events } = harness();
  await session.loadSymbol(sym("alpha"));
  provider.questionError = Object.assign(new Error("aborted"), { name: "AbortError" });

  events.length = 0;
  await session.handleFollowup("why?");

  assert.equal(
    events.some((event) => event.type === "qaStreamError"),
    false,
  );
  assert.equal(session.currentArticle?.qas?.length, 0);
});

test("the hermes policy hands over a composed prompt", async () => {
  const { session, calls } = harness({ getFollowupAction: () => "hermes" });
  await session.loadSymbol(sym("alpha"));
  await session.handleFollowup("why?");

  assert.equal(calls.hermes.length, 1);
  assert.equal(
    calls.hermes[0],
    "Regarding `alpha` (Function) in `src/alpha.ts`:\n\nQuestion: why?",
  );
});

test("the clipboard policy copies the prompt and reports it", async () => {
  const { session, calls } = harness({ getFollowupAction: () => "clipboard" });
  await session.loadSymbol(sym("alpha"));
  await session.handleFollowup("why?");

  assert.equal(calls.clipboard[0], "Regarding `alpha` (Function) in `src/alpha.ts`:\nwhy?");
  assert.equal(calls.infos[0], 'Copied question to clipboard: "why?"');
});

test("the deepwiki policy opens the question as a follow-up article", async () => {
  const { session } = harness({ getFollowupAction: () => "deepwiki" });
  await session.loadSymbol(sym("alpha"));
  await session.handleFollowup("why?");

  assert.equal(session.currentArticle?.symbol.kind, "Follow-up");
  assert.equal(session.currentArticle?.symbol.name, "alpha • why?");
  assert.equal(session.canGoBack, true);
});

test("a follow-up with no article warns instead of streaming", async () => {
  const { session, calls, events } = harness();
  await session.handleFollowup("why?");

  assert.deepEqual(calls.warnings, ["No active symbol to ask questions about."]);
  assert.deepEqual(events, []);
});

test("sendToHermes includes the inline answer", async () => {
  const { session, calls } = harness();
  await session.loadSymbol(sym("alpha"));
  await session.sendToHermes("why?", "because");

  assert.equal(
    calls.hermes[0],
    "Regarding `alpha` (Function) in `src/alpha.ts`:\n\nQuestion: why?\n\nDeepWiki Inline Answer:\nbecause",
  );
});

test("sendToHermes without an article forwards the bare question", async () => {
  const { session, calls } = harness();
  await session.sendToHermes("why?");

  assert.deepEqual(calls.hermes, ["why?"]);
});

test("restore re-emits the article for a newly resolved webview", async () => {
  const { session, events } = harness();
  await session.loadSymbol(sym("alpha"));

  events.length = 0;
  session.restore();

  assert.deepEqual(types(events), ["setSymbol", "streamComplete", "setHistoryState"]);
});

test("restore is a no-op without an article", () => {
  const { session, events } = harness();
  session.restore();
  assert.deepEqual(events, []);
});
