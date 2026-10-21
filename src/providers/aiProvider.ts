import * as vscode from "vscode";
import type { DeepWikiSymbol } from "../types";
import {
  anthropicRequest,
  type ChatRequest,
  geminiRequest,
  ollamaRequest,
  openAiRequest,
  pickProvider,
  type Settings,
} from "./requests";
import { parseFollowupQuestions, streamLines } from "./streaming";

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

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration("deepwiki");
  return {
    providerType: config.get<string>("provider", "auto"),
    apiKey: config.get<string>("apiKey", ""),
    baseUrl: config.get<string>("apiBaseUrl", ""),
    model: config.get<string>("model", ""),
    devinPort: config.get<number>("devinBridgePort", 0),
  };
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

class HttpError extends Error {
  readonly status: number;

  constructor(label: string, status: number, detail: string) {
    super(`${label} error (${status}): ${detail}`);
    this.name = "HttpError";
    this.status = status;
  }
}

async function runRequest(
  req: ChatRequest,
  onDelta: (delta: string) => void,
  abortSignal?: AbortSignal,
): Promise<string> {
  const response = await fetch(req.endpoint, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: abortSignal,
  });

  if (!response.ok) {
    throw new HttpError(req.label, response.status, await response.text());
  }

  return streamLines(response, onDelta, req.parseLine);
}

/** Every provider: build a request, stream it, split off the follow-ups. */
abstract class ChatProvider implements IAIProvider {
  protected readonly settings = readSettings();

  protected abstract buildRequest(system: string, user: string): ChatRequest;

  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const { text, model } = await this.generate(
      buildDeepWikiSystemPrompt(),
      buildDeepWikiUserPrompt(symbol),
      onDelta,
      abortSignal,
    );
    const { markdown, questions } = parseFollowupQuestions(text);
    return { fullMarkdown: markdown, followupQuestions: questions, modelType: model };
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const { text, model } = await this.generate(
      buildFollowupSystemPrompt(),
      buildFollowupUserPrompt(symbol, articleMarkdown, question),
      onDelta,
      abortSignal,
    );
    return { fullMarkdown: text, modelType: model };
  }

  protected async generate(
    system: string,
    user: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ text: string; model: string }> {
    const req = this.buildRequest(system, user);
    return { text: await runRequest(req, onDelta, abortSignal), model: req.model };
  }
}

/**
 * Ollama, with a retry in the OpenAI chat format when the endpoint is not an Ollama server.
 */
export class OllamaProvider extends ChatProvider {
  protected buildRequest(system: string, user: string): ChatRequest {
    return ollamaRequest(this.settings, system, user);
  }

  protected async generate(
    system: string,
    user: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ text: string; model: string }> {
    try {
      return await super.generate(system, user, onDelta, abortSignal);
    } catch (err) {
      if (!(err instanceof HttpError) || ![401, 403, 404].includes(err.status)) {
        throw err;
      }
      if (!this.settings.apiKey && this.settings.baseUrl.includes("11434")) {
        throw err;
      }
      const fallback = openAiRequest(this.settings, system, user);
      return { text: await runRequest(fallback, onDelta, abortSignal), model: fallback.model };
    }
  }
}

/**
 * OpenAI / Compatible Provider (DeepSeek, Groq, OpenAI, CommandCode, etc.)
 */
export class OpenAICompatibleProvider extends ChatProvider {
  protected buildRequest(system: string, user: string): ChatRequest {
    return openAiRequest(this.settings, system, user);
  }
}

/**
 * Anthropic Claude Provider
 */
export class AnthropicProvider extends ChatProvider {
  protected buildRequest(system: string, user: string): ChatRequest {
    return anthropicRequest(this.settings, system, user);
  }
}

/**
 * Gemini Provider
 */
export class GeminiProvider extends ChatProvider {
  protected buildRequest(system: string, user: string): ChatRequest {
    return geminiRequest(this.settings, system, user);
  }
}

/**
 * Devin Local Bridge Provider (local language server, when Devin is running)
 */
export class DevinBridgeProvider implements IAIProvider {
  private readonly settings = readSettings();

  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const text = await this.callBridge(symbol, symbol.enclosingCode, abortSignal);
    if (text !== undefined) {
      onDelta(text);
      return { fullMarkdown: text, followupQuestions: [], modelType: "Devin Local Bridge" };
    }
    return new OllamaProvider().streamArticle(symbol, onDelta, abortSignal);
  }

  async streamQuestion(
    symbol: DeepWikiSymbol,
    articleMarkdown: string,
    question: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiQuestionResult> {
    const context = `${articleMarkdown}\n\nQuestion: ${question}`;
    const text = await this.callBridge(symbol, context, abortSignal);
    if (text !== undefined) {
      onDelta(text);
      return { fullMarkdown: text, modelType: "Devin Local Bridge" };
    }
    return new OllamaProvider().streamQuestion(
      symbol,
      articleMarkdown,
      question,
      onDelta,
      abortSignal,
    );
  }

  /** Bridge answer, or undefined when the local server is not reachable. */
  private async callBridge(
    symbol: DeepWikiSymbol,
    context: string,
    abortSignal?: AbortSignal,
  ): Promise<string | undefined> {
    const port = this.settings.devinPort || 3000;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetDeepWiki`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // shortcut: the bridge protocol is undocumented here, so a question goes out as an
          // article request with the question in `context`. Split it out if Devin gets a Q&A type.
          body: JSON.stringify({
            symbolName: symbol.name,
            symbolUri: symbol.uri,
            context,
            requestType: 1, // ARTICLE
          }),
          signal: abortSignal,
        },
      );
      if (!response.ok) return undefined;
      const data: any = await response.json();
      return data?.rawResponse?.deltaMessage?.text || "";
    } catch {
      return undefined;
    }
  }
}

export class AIProviderFactory {
  public static createProvider(): IAIProvider {
    switch (pickProvider(readSettings())) {
      case "openai":
        return new OpenAICompatibleProvider();
      case "anthropic":
        return new AnthropicProvider();
      case "gemini":
        return new GeminiProvider();
      case "devin_bridge":
        return new DevinBridgeProvider();
      case "ollama":
        return new OllamaProvider();
    }
  }
}
