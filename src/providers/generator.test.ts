import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepWikiSymbol } from "../types.ts";
import { createGenerator, type Transport } from "./generator.ts";
import type { Settings } from "./requests.ts";

const symbol: DeepWikiSymbol = {
  name: "Foo",
  kind: "Function",
  uri: "file:///src/a.ts",
  relativePath: "src/a.ts",
  selectionRange: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 3 },
  enclosingCode: "function Foo() {}",
  languageId: "typescript",
};

const settings = (over: Partial<Settings> = {}): Settings => ({
  providerType: "openai",
  apiKey: "k",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  devinPort: 0,
  ...over,
});

function openAiBody(text: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`);
}

function ollamaBody(text: string): Response {
  return new Response(`${JSON.stringify({ response: text })}\n`);
}

test("article and follow-up prompts are the bytes posted", async () => {
  const bodies: { messages: { content: string }[] }[] = [];
  const transport: Transport = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as { messages: { content: string }[] });
    return openAiBody("Hello");
  };
  const generator = createGenerator(settings(), transport);
  const deltas: string[] = [];

  const article = await generator.streamArticle(symbol, (delta) => deltas.push(delta));
  assert.equal(article.fullMarkdown, "Hello");
  assert.deepEqual(deltas, ["Hello"]);
  assert.match(bodies[0]?.messages[0]?.content ?? "", /## Overview & Purpose/);
  assert.match(bodies[0]?.messages[1]?.content ?? "", /Symbol Name: Foo/);
  assert.match(bodies[0]?.messages[1]?.content ?? "", /function Foo\(\) \{\}/);

  await generator.streamQuestion(symbol, "article body", "Why?", () => {});
  assert.match(bodies[1]?.messages[1]?.content ?? "", /Follow-up Question:\nWhy\?/);
});

test("a non-OK chat response fails and is not retried", async () => {
  let calls = 0;
  const transport: Transport = async () => {
    calls += 1;
    return new Response("boom", { status: 500 });
  };
  const generator = createGenerator(settings(), transport);
  await assert.rejects(() => generator.streamArticle(symbol, () => {}), /API error \(500\): boom/);
  assert.equal(calls, 1);
});

test("Ollama 404 without a key does not fall back", async () => {
  let calls = 0;
  const transport: Transport = async () => {
    calls += 1;
    return new Response("missing", { status: 404 });
  };
  const generator = createGenerator(
    settings({ providerType: "ollama", apiKey: "", baseUrl: "http://localhost:11434" }),
    transport,
  );
  await assert.rejects(() => generator.streamArticle(symbol, () => {}), /Ollama error \(404\)/);
  assert.equal(calls, 1);
});

test("Ollama 404 with a key retries as an OpenAI chat request", async () => {
  const urls: string[] = [];
  const transport: Transport = async (url) => {
    urls.push(url);
    if (url.includes("/api/generate")) return new Response("missing", { status: 404 });
    return openAiBody("fallback");
  };
  const generator = createGenerator(
    settings({ providerType: "ollama", apiKey: "k", baseUrl: "http://localhost:11434" }),
    transport,
  );
  const result = await generator.streamArticle(symbol, () => {});
  assert.equal(result.fullMarkdown, "fallback");
  assert.equal(result.modelType, "gpt-4o-mini");
  assert.equal(urls.length, 2);
  assert.match(urls[1] ?? "", /api\.openai\.com/);
});

test("an unreachable Devin bridge falls back to Ollama", async () => {
  const urls: string[] = [];
  const transport: Transport = async (url) => {
    urls.push(url);
    if (url.includes("GetDeepWiki")) throw new Error("connect ECONNREFUSED");
    return ollamaBody("from-ollama");
  };
  const generator = createGenerator(
    settings({
      providerType: "devin_bridge",
      apiKey: "",
      baseUrl: "http://localhost:11434",
      devinPort: 9,
    }),
    transport,
  );
  const result = await generator.streamArticle(symbol, () => {});
  assert.equal(result.fullMarkdown, "from-ollama");
  assert.equal(urls.length, 2);
  assert.match(urls[1] ?? "", /\/api\/generate/);
});

test("a Devin answer is returned without a chat fallback", async () => {
  let calls = 0;
  const transport: Transport = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ rawResponse: { deltaMessage: { text: "bridge article" } } }),
    );
  };
  const generator = createGenerator(
    settings({ providerType: "devin_bridge", devinPort: 9 }),
    transport,
  );
  const deltas: string[] = [];
  const result = await generator.streamArticle(symbol, (delta) => deltas.push(delta));
  assert.equal(result.fullMarkdown, "bridge article");
  assert.deepEqual(result.followupQuestions, []);
  assert.equal(result.modelType, "Devin Local Bridge");
  assert.deepEqual(deltas, ["bridge article"]);
  assert.equal(calls, 1);
});

test("an aborted stream rejects", async () => {
  const controller = new AbortController();
  controller.abort();
  const transport: Transport = async (_url, init) => {
    if (init.signal?.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return openAiBody("nope");
  };
  const generator = createGenerator(settings(), transport);
  await assert.rejects(
    () => generator.streamArticle(symbol, () => {}, controller.signal),
    (err: unknown) => err instanceof Error && err.name === "AbortError",
  );
});

test("pt-BR outputLanguage configures Portuguese system and user prompts", async () => {
  const bodies: { messages: { content: string }[] }[] = [];
  const transport: Transport = async (_url, init) => {
    bodies.push(JSON.parse(init.body) as { messages: { content: string }[] });
    return openAiBody("Artigo em Português");
  };
  const generator = createGenerator(settings({ outputLanguage: "pt-BR" }), transport);

  const article = await generator.streamArticle(symbol, () => {});
  assert.equal(article.fullMarkdown, "Artigo em Português");
  assert.match(bodies[0]?.messages[0]?.content ?? "", /## Visão Geral e Propósito/);
  assert.match(bodies[0]?.messages[0]?.content ?? "", /Português Brasileiro/);
  assert.match(bodies[0]?.messages[1]?.content ?? "", /Nome do Símbolo: Foo/);

  await generator.streamQuestion(symbol, "corpo do artigo", "Por que?", () => {});
  assert.match(bodies[1]?.messages[0]?.content ?? "", /Português Brasileiro/);
  assert.match(bodies[1]?.messages[1]?.content ?? "", /Pergunta de Acompanhamento:\nPor que\?/);
});
