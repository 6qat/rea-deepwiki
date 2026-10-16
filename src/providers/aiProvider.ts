import * as vscode from "vscode";
import type { DeepWikiSymbol } from "../types";

export interface DeepWikiGenerationResult {
  fullMarkdown: string;
  followupQuestions: string[];
  modelType: string;
}

export interface DeepWikiQuestionResult {
  fullMarkdown: string;
  modelType: string;
}

export interface IAIProvider {
  streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult>;

  streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult>;
}

export class AIProviderFactory {
  public static createProvider(): IAIProvider {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const providerType = config.get<string>("provider", "auto");
    const apiKey = config.get<string>("apiKey", "");
    const baseUrl = config.get<string>("apiBaseUrl", "");

    if (providerType === "openai") {
      return new OpenAICompatibleProvider();
    }
    if (providerType === "anthropic") {
      return new AnthropicProvider();
    }
    if (providerType === "gemini") {
      return new GeminiProvider();
    }
    if (providerType === "devin_bridge") {
      return new DevinBridgeProvider();
    }

    // If set to ollama, but configured with an external API key or non-localhost URL (e.g. commandcode.ai, openrouter)
    if (providerType === "ollama") {
      if (
        baseUrl &&
        !baseUrl.includes("localhost") &&
        !baseUrl.includes("127.0.0.1") &&
        (apiKey || baseUrl.includes("/v1"))
      ) {
        return new OpenAICompatibleProvider();
      }
      return new OllamaProvider();
    }

    // Auto-detection logic:
    if (baseUrl.includes("anthropic.com")) {
      return new AnthropicProvider();
    }
    if (baseUrl.includes("generativelanguage.googleapis.com")) {
      return new GeminiProvider();
    }
    if (
      apiKey ||
      (baseUrl && !baseUrl.includes("localhost:11434") && !baseUrl.includes("127.0.0.1:11434"))
    ) {
      return new OpenAICompatibleProvider();
    }

    return new OllamaProvider();
  }
}

export function buildDeepWikiSystemPrompt(): string {
  return `You are DeepWiki, the interactive code encyclopedia built into the developer's workspace.
Your purpose is to generate an authoritative, clear, and comprehensive architectural documentation article for any code symbol (function, class, module, interface, variable) in the user's project.

Guidelines:
1. Provide a technical, precise explanation of the symbol's responsibilities, invariants, inputs, and outputs.
2. Structure the article cleanly with Markdown headers:
   - ## Overview & Purpose
   - ## Signature & Contract
   - ## Implementation & Data Flow
   - ## Usage & Edge Cases
3. When referencing code lines from the provided context, cite them accurately with file and line references.
4. At the very end of your response, you MUST provide exactly 3 concise follow-up questions to help the developer explore deeper. Separate them using this exact delimiter:
<!-- DEEPWIKI_FOLLOWUPS -->
- Question 1?
- Question 2?
- Question 3?`;
}

export function buildDeepWikiUserPrompt(symbol: DeepWikiSymbol): string {
  return `Please document the following symbol:

Symbol Name: ${symbol.name}
Symbol Kind: ${symbol.kind}
File: ${symbol.relativePath} (lines ${symbol.selectionRange.startLine}:${symbol.selectionRange.startColumn} - ${symbol.selectionRange.endLine}:${symbol.selectionRange.endColumn})
Language: ${symbol.languageId}

Enclosing Code Context:
\`\`\`${symbol.languageId}
${symbol.enclosingCode}
\`\`\`

Generate a complete DeepWiki article for ${symbol.name}.`;
}

export function buildFollowupSystemPrompt(): string {
  return `You are DeepWiki, the interactive workspace encyclopedia assistant.
You are answering a developer's follow-up question regarding a specific code symbol and its architecture.

Guidelines:
1. Provide a direct, technically accurate, and focused answer based on the symbol's implementation and context.
2. If relevant, include concise code snippets with proper syntax highlighting.
3. Be clear, succinct, and informative.`;
}

export function buildFollowupUserPrompt(
  symbol: DeepWikiSymbol,
  articleMarkdown: string,
  question: string,
): string {
  const summarySnippet = articleMarkdown ? articleMarkdown.slice(0, 1500) : "";
  return `Context - Code Symbol:
Name: ${symbol.name} (${symbol.kind})
File: ${symbol.relativePath}
Language: ${symbol.languageId}

Source Code:
\`\`\`${symbol.languageId}
${symbol.enclosingCode}
\`\`\`

${summarySnippet ? `DeepWiki Article Summary:\n${summarySnippet}\n` : ""}
Follow-up Question:
${question}

Please answer the question clearly and directly.`;
}

export function parseFollowupQuestions(text: string): {
  markdown: string;
  questions: string[];
} {
  const delimiter = "<!-- DEEPWIKI_FOLLOWUPS -->";
  const index = text.indexOf(delimiter);
  if (index === -1) {
    return { markdown: text, questions: [] };
  }

  const markdown = text.substring(0, index).trim();
  const followupSection = text.substring(index + delimiter.length).trim();

  const questions: string[] = [];
  const lines = followupSection.split("\n");
  for (let line of lines) {
    line = line.replace(/^\s*[-*•\d.]+\s*/, "").trim();
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).trim();
    }
    if (line.length > 5) {
      questions.push(line);
    }
  }

  return {
    markdown,
    questions: questions.slice(0, 3),
  };
}

/**
 * Ollama Provider (Default for local, private development)
 */
export class OllamaProvider implements IAIProvider {
  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const baseUrl = config.get<string>("apiBaseUrl", "http://localhost:11434");
    const model = config.get<string>("model", "llama3.2");

    const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/generate`;
    const prompt = `${buildDeepWikiSystemPrompt()}\n\n${buildDeepWikiUserPrompt(symbol)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const apiKey = config.get<string>("apiKey", "");
      if (
        (response.status === 404 || response.status === 401 || response.status === 403) &&
        (apiKey || !baseUrl.includes("11434"))
      ) {
        const fallback = new OpenAICompatibleProvider();
        return fallback.streamArticle(symbol, onDelta, abortSignal);
      }
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body received from Ollama");
    }

    let fullText = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            fullText += parsed.response;
            onDelta(parsed.response);
          }
        } catch {
          // ignore chunk parse errors
        }
      }
    }

    const { markdown, questions } = parseFollowupQuestions(fullText);
    return {
      fullMarkdown: markdown,
      followupQuestions: questions,
      modelType: model,
    };
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const baseUrl = config.get<string>("apiBaseUrl", "http://localhost:11434");
    const model = config.get<string>("model", "llama3.2");

    const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/generate`;
    const prompt = `${buildFollowupSystemPrompt()}\n\n${buildFollowupUserPrompt(symbol, articleMarkdown, question)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const apiKey = config.get<string>("apiKey", "");
      if (
        (response.status === 404 || response.status === 401 || response.status === 403) &&
        (apiKey || !baseUrl.includes("11434"))
      ) {
        const fallback = new OpenAICompatibleProvider();
        return fallback.streamQuestion(symbol, articleMarkdown, question, onDelta, abortSignal);
      }
      throw new Error(`Ollama error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body received from Ollama");
    }

    let fullText = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            fullText += parsed.response;
            onDelta(parsed.response);
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      fullMarkdown: fullText,
      modelType: model,
    };
  }
}

/**
 * OpenAI / Compatible Provider (DeepSeek, Groq, OpenAI, CommandCode, etc.)
 */
export class OpenAICompatibleProvider implements IAIProvider {
  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const baseUrl = config.get<string>("apiBaseUrl", "https://api.openai.com/v1");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "gpt-4o-mini");

    if (!apiKey && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
      throw new Error("API Key is required. Set it in DeepWiki settings.");
    }

    const cleanBase = baseUrl.replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions")
      ? cleanBase
      : `${cleanBase}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: buildDeepWikiSystemPrompt() },
          { role: "user", content: buildDeepWikiUserPrompt(symbol) },
        ],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body from API");
    }

    let fullText = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        if (trimmed === "data: [DONE]") break;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onDelta(delta);
          }
        } catch {
          // ignore chunk parse errors
        }
      }
    }

    const { markdown, questions } = parseFollowupQuestions(fullText);
    return {
      fullMarkdown: markdown,
      followupQuestions: questions,
      modelType: model,
    };
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const baseUrl = config.get<string>("apiBaseUrl", "https://api.openai.com/v1");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "gpt-4o-mini");

    if (!apiKey && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
      throw new Error("API Key is required. Set it in DeepWiki settings.");
    }

    const cleanBase = baseUrl.replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/chat/completions")
      ? cleanBase
      : `${cleanBase}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: buildFollowupSystemPrompt() },
          { role: "user", content: buildFollowupUserPrompt(symbol, articleMarkdown, question) },
        ],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body from API");
    }

    let fullText = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        if (trimmed === "data: [DONE]") break;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onDelta(delta);
          }
        } catch {
          // ignore chunk parse errors
        }
      }
    }

    return {
      fullMarkdown: fullText,
      modelType: model,
    };
  }
}

/**
 * Anthropic Claude Provider
 */
export class AnthropicProvider implements IAIProvider {
  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "claude-3-5-sonnet-latest");

    if (!apiKey) {
      throw new Error("Anthropic API Key is required. Set it in DeepWiki settings.");
    }

    const endpoint = "https://api.anthropic.com/v1/messages";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system: buildDeepWikiSystemPrompt(),
        messages: [{ role: "user", content: buildDeepWikiUserPrompt(symbol) }],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error (${response.status}): ${err}`);
    }

    let fullText = "";
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.type === "content_block_delta" && json.delta?.text) {
            fullText += json.delta.text;
            onDelta(json.delta.text);
          }
        } catch {
          // ignore
        }
      }
    }

    const { markdown, questions } = parseFollowupQuestions(fullText);
    return {
      fullMarkdown: markdown,
      followupQuestions: questions,
      modelType: model,
    };
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "claude-3-5-sonnet-latest");

    if (!apiKey) {
      throw new Error("Anthropic API Key is required. Set it in DeepWiki settings.");
    }

    const endpoint = "https://api.anthropic.com/v1/messages";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        system: buildFollowupSystemPrompt(),
        messages: [
          { role: "user", content: buildFollowupUserPrompt(symbol, articleMarkdown, question) },
        ],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error (${response.status}): ${err}`);
    }

    let fullText = "";
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          if (json.type === "content_block_delta" && json.delta?.text) {
            fullText += json.delta.text;
            onDelta(json.delta.text);
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      fullMarkdown: fullText,
      modelType: model,
    };
  }
}

/**
 * Gemini Provider
 */
export class GeminiProvider implements IAIProvider {
  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "gemini-2.0-flash");

    if (!apiKey) {
      throw new Error("Gemini API Key is required. Set it in DeepWiki settings.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildDeepWikiSystemPrompt() }] },
        contents: [{ role: "user", parts: [{ text: buildDeepWikiUserPrompt(symbol) }] }],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini error (${response.status}): ${err}`);
    }

    let fullText = "";
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textPart) {
            fullText += textPart;
            onDelta(textPart);
          }
        } catch {
          // ignore
        }
      }
    }

    const { markdown, questions } = parseFollowupQuestions(fullText);
    return {
      fullMarkdown: markdown,
      followupQuestions: questions,
      modelType: model,
    };
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "gemini-2.0-flash");

    if (!apiKey) {
      throw new Error("Gemini API Key is required. Set it in DeepWiki settings.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildFollowupSystemPrompt() }] },
        contents: [
          {
            role: "user",
            parts: [{ text: buildFollowupUserPrompt(symbol, articleMarkdown, question) }],
          },
        ],
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini error (${response.status}): ${err}`);
    }

    let fullText = "";
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const textPart = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textPart) {
            fullText += textPart;
            onDelta(textPart);
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      fullMarkdown: fullText,
      modelType: model,
    };
  }
}

/**
 * Devin Local Bridge Provider (Attempts local language server connection if Devin is active)
 */
export class DevinBridgeProvider implements IAIProvider {
  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const config = vscode.workspace.getConfiguration("deepwiki");
    let port = config.get<number>("devinBridgePort", 0);

    if (port === 0) {
      port = 3000;
    }

    try {
      const endpoint = `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetDeepWiki`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbolName: symbol.name,
          symbolUri: symbol.uri,
          context: symbol.enclosingCode,
          requestType: 1, // ARTICLE
        }),
        signal: abortSignal,
      });

      if (response.ok) {
        const data = await response.json();
        const text = (data as any)?.rawResponse?.deltaMessage?.text || "";
        onDelta(text);
        return {
          fullMarkdown: text,
          followupQuestions: [],
          modelType: "Devin Local Bridge",
        };
      }
    } catch {
      // Fallback
    }

    const fallback = new OllamaProvider();
    return fallback.streamArticle(symbol, onDelta, abortSignal);
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const fallback = new OllamaProvider();
    return fallback.streamQuestion(symbol, articleMarkdown, question, onDelta, abortSignal);
  }
}
