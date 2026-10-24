import {
  type DeltaParser,
  parseAnthropicDelta,
  parseGeminiDelta,
  parseOllamaDelta,
  parseOpenAiDelta,
} from "./streaming.ts";

// Pure request builders: no `vscode` import, so they can be unit-tested.

export interface Settings {
  providerType: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  devinPort: number;
  outputLanguage?: string;
}

const OLLAMA_URL = "http://localhost:11434";
const OLLAMA_MODEL = "llama3.2";

export function isLocalHost(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export function isOllamaUrl(url: string): boolean {
  return url.includes("localhost:11434") || url.includes("127.0.0.1:11434");
}

/** The model setting defaults to the Ollama one; for a cloud provider that means "not chosen". */
export function modelOrDefault(configured: string, fallback: string): string {
  return configured && configured !== OLLAMA_MODEL ? configured : fallback;
}

export type ProviderKind = "ollama" | "openai" | "anthropic" | "gemini" | "devin_bridge";

/** Which provider the settings describe. `auto` (or anything unknown) decides from the URL and key. */
export function pickProvider({ providerType, apiKey, baseUrl }: Settings): ProviderKind {
  switch (providerType) {
    case "openai":
    case "anthropic":
    case "gemini":
    case "devin_bridge":
      return providerType;
    case "ollama":
      // "ollama" pointed at a remote host with a key is really an OpenAI-compatible endpoint.
      return baseUrl && !isLocalHost(baseUrl) && (apiKey || baseUrl.includes("/v1"))
        ? "openai"
        : "ollama";
  }

  if (baseUrl.includes("anthropic.com")) return "anthropic";
  if (baseUrl.includes("generativelanguage.googleapis.com")) return "gemini";
  if (apiKey || (baseUrl && !isOllamaUrl(baseUrl))) return "openai";
  return "ollama";
}

export interface ChatRequest {
  label: string;
  endpoint: string;
  headers: Record<string, string>;
  body: unknown;
  parseLine: DeltaParser;
  model: string;
}

export function openAiRequest(settings: Settings, system: string, user: string): ChatRequest {
  const configured = (settings.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  // The settings defaults point at Ollama, so with a cloud key they were never a choice.
  const bareOllamaRoot = /^https?:\/\/(localhost|127\.0\.0\.1):11434$/.test(configured);
  const baseUrl = bareOllamaRoot ? "https://api.openai.com/v1" : configured;
  // Only OpenAI itself can't serve the Ollama default; LM Studio, vLLM etc. may well serve llama3.2.
  const model =
    bareOllamaRoot || baseUrl.includes("api.openai.com")
      ? modelOrDefault(settings.model, "gpt-4o-mini")
      : settings.model || "gpt-4o-mini";

  if (!settings.apiKey && !isLocalHost(baseUrl)) {
    throw new Error("API Key is required. Set it in DeepWiki settings.");
  }

  return {
    label: "API",
    endpoint: baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: {
      model,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    parseLine: parseOpenAiDelta,
    model,
  };
}

export function ollamaRequest(settings: Settings, system: string, user: string): ChatRequest {
  const baseUrl = settings.baseUrl.replace(/\/+$/, "") || OLLAMA_URL;
  const model = settings.model || OLLAMA_MODEL;
  return {
    label: "Ollama",
    endpoint: `${baseUrl}/api/generate`,
    headers: { "Content-Type": "application/json" },
    body: { model, prompt: `${system}\n\n${user}`, stream: true },
    parseLine: parseOllamaDelta,
    model,
  };
}

export function anthropicRequest(settings: Settings, system: string, user: string): ChatRequest {
  if (!settings.apiKey) {
    throw new Error("Anthropic API Key is required. Set it in DeepWiki settings.");
  }
  const model = modelOrDefault(settings.model, "claude-3-5-sonnet-latest");
  return {
    label: "Anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model,
      max_tokens: 4096,
      stream: true,
      system,
      messages: [{ role: "user", content: user }],
    },
    parseLine: parseAnthropicDelta,
    model,
  };
}

export function geminiRequest(settings: Settings, system: string, user: string): ChatRequest {
  if (!settings.apiKey) {
    throw new Error("Gemini API Key is required. Set it in DeepWiki settings.");
  }
  const model = modelOrDefault(settings.model, "gemini-2.0-flash");
  return {
    label: "Gemini",
    // Key in a header, not the query string: URLs end up in logs and error messages.
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.apiKey,
    },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
    },
    parseLine: parseGeminiDelta,
    model,
  };
}
