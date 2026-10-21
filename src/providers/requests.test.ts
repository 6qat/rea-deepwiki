import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anthropicRequest,
  geminiRequest,
  modelOrDefault,
  ollamaRequest,
  openAiRequest,
  pickProvider,
  type Settings,
} from "./requests.ts";

const settings = (over: Partial<Settings> = {}): Settings => ({
  providerType: "auto",
  apiKey: "k",
  baseUrl: "http://localhost:11434",
  model: "llama3.2",
  devinPort: 0,
  ...over,
});

test("modelOrDefault treats the Ollama default as 'not chosen'", () => {
  assert.equal(modelOrDefault("llama3.2", "gpt-4o-mini"), "gpt-4o-mini");
  assert.equal(modelOrDefault("", "gpt-4o-mini"), "gpt-4o-mini");
  assert.equal(modelOrDefault("gpt-4o", "gpt-4o-mini"), "gpt-4o");
});

test("OpenAI-format: bare Ollama root with a key goes to OpenAI with its default model", () => {
  const req = openAiRequest(settings(), "s", "u");
  assert.equal(req.endpoint, "https://api.openai.com/v1/chat/completions");
  assert.equal(req.model, "gpt-4o-mini");
});

test("OpenAI-format: LM Studio / vLLM keep a model that happens to be llama3.2", () => {
  const req = openAiRequest(
    settings({ baseUrl: "http://localhost:1234/v1", apiKey: "" }),
    "s",
    "u",
  );
  assert.equal(req.endpoint, "http://localhost:1234/v1/chat/completions");
  assert.equal(req.model, "llama3.2");
});

test("OpenAI-format: a remote URL without a key is an error", () => {
  assert.throws(
    () => openAiRequest(settings({ baseUrl: "https://api.example.com/v1", apiKey: "" }), "s", "u"),
    /API Key is required/,
  );
});

test("Ollama: trims the trailing slash and keeps the configured model", () => {
  const req = ollamaRequest(settings({ baseUrl: "http://box:11434/", model: "qwen2.5" }), "s", "u");
  assert.equal(req.endpoint, "http://box:11434/api/generate");
  assert.equal(req.model, "qwen2.5");
});

test("Anthropic: requires a key, and swaps the Ollama default model", () => {
  assert.throws(() => anthropicRequest(settings({ apiKey: "" }), "s", "u"), /Anthropic API Key/);
  assert.equal(anthropicRequest(settings(), "s", "u").model, "claude-3-5-sonnet-latest");
});

test("Gemini: the key travels in a header, never in the URL", () => {
  const req = geminiRequest(settings({ apiKey: "secret" }), "s", "u");
  assert.equal(req.headers["x-goog-api-key"], "secret");
  assert.ok(!req.endpoint.includes("secret"));
});

const pick = (over: Partial<Settings>) => pickProvider(settings(over));

test("pickProvider: an explicit provider wins", () => {
  for (const kind of ["openai", "anthropic", "gemini", "devin_bridge"] as const) {
    assert.equal(pick({ providerType: kind, apiKey: "" }), kind);
  }
});

test("pickProvider: 'ollama' on a remote host with a key or /v1 is OpenAI-compatible", () => {
  assert.equal(
    pick({ providerType: "ollama", baseUrl: "https://openrouter.ai/api/v1", apiKey: "" }),
    "openai",
  );
  assert.equal(
    pick({ providerType: "ollama", baseUrl: "https://host.example", apiKey: "k" }),
    "openai",
  );
});

test("pickProvider: 'ollama' stays Ollama on localhost or a remote host with no key and no /v1", () => {
  assert.equal(
    pick({ providerType: "ollama", baseUrl: "http://localhost:1234", apiKey: "k" }),
    "ollama",
  );
  assert.equal(
    pick({ providerType: "ollama", baseUrl: "http://192.168.1.5:11434", apiKey: "" }),
    "ollama",
  );
});

test("pickProvider: auto reads the URL, then the key", () => {
  assert.equal(pick({ baseUrl: "https://api.anthropic.com", apiKey: "" }), "anthropic");
  assert.equal(
    pick({ baseUrl: "https://generativelanguage.googleapis.com", apiKey: "" }),
    "gemini",
  );
  assert.equal(pick({ baseUrl: "http://localhost:11434", apiKey: "k" }), "openai");
  assert.equal(pick({ baseUrl: "https://api.deepseek.com/v1", apiKey: "" }), "openai");
  assert.equal(pick({ baseUrl: "http://localhost:11434", apiKey: "" }), "ollama");
  assert.equal(pick({ baseUrl: "", apiKey: "" }), "ollama");
});
