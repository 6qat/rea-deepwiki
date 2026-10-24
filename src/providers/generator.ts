import type { DeepWikiSymbol } from "../types.ts";
import {
  anthropicRequest,
  type ChatRequest,
  geminiRequest,
  ollamaRequest,
  openAiRequest,
  type ProviderKind,
  pickProvider,
  type Settings,
} from "./requests.ts";
import { parseFollowupQuestions, streamLines } from "./streaming.ts";

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

export type Transport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

class HttpError extends Error {
  readonly status: number;

  constructor(label: string, status: number, detail: string) {
    super(`${label} error (${status}): ${detail}`);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Streams an article or a follow-up. Vendor choice, prompts, HTTP, the Ollama
 * retry, and the Devin fallback stay behind this interface.
 */
export function createGenerator(settings: Settings, transport: Transport = fetch): IAIProvider {
  return new Generator(settings, transport);
}

class Generator implements IAIProvider {
  private readonly settings: Settings;
  private readonly transport: Transport;

  constructor(settings: Settings, transport: Transport) {
    this.settings = settings;
    this.transport = transport;
  }

  async streamArticle(
    symbol: DeepWikiSymbol,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<DeepWikiGenerationResult> {
    const kind = pickProvider(this.settings);
    if (kind === "devin_bridge") {
      const text = await this.callBridge(symbol, symbol.enclosingCode, abortSignal);
      if (text !== undefined) {
        onDelta(text);
        return { fullMarkdown: text, followupQuestions: [], modelType: "Devin Local Bridge" };
      }
    }

    const lang = this.settings.outputLanguage ?? "en";
    const chatKind = kind === "devin_bridge" ? "ollama" : kind;
    const { text, model } = await this.streamText(
      chatKind,
      articleSystemPrompt(lang),
      articleUserPrompt(symbol, lang),
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
    const kind = pickProvider(this.settings);
    if (kind === "devin_bridge") {
      const context = `${articleMarkdown}\n\nQuestion: ${question}`;
      const text = await this.callBridge(symbol, context, abortSignal);
      if (text !== undefined) {
        onDelta(text);
        return { fullMarkdown: text, modelType: "Devin Local Bridge" };
      }
    }

    const lang = this.settings.outputLanguage ?? "en";
    const chatKind = kind === "devin_bridge" ? "ollama" : kind;
    const { text, model } = await this.streamText(
      chatKind,
      followupSystemPrompt(lang),
      followupUserPrompt(symbol, articleMarkdown, question, lang),
      onDelta,
      abortSignal,
    );
    return { fullMarkdown: text, modelType: model };
  }

  private async streamText(
    kind: Exclude<ProviderKind, "devin_bridge">,
    system: string,
    user: string,
    onDelta: (delta: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<{ text: string; model: string }> {
    try {
      const req = requestFor(kind, this.settings, system, user);
      return {
        text: await runRequest(this.transport, req, onDelta, abortSignal),
        model: req.model,
      };
    } catch (err) {
      if (kind !== "ollama") throw err;
      if (!(err instanceof HttpError) || ![401, 403, 404].includes(err.status)) throw err;
      if (!this.settings.apiKey && this.settings.baseUrl.includes("11434")) throw err;
      const fallback = openAiRequest(this.settings, system, user);
      return {
        text: await runRequest(this.transport, fallback, onDelta, abortSignal),
        model: fallback.model,
      };
    }
  }

  /** Bridge answer, or undefined when the local server is not reachable. */
  private async callBridge(
    symbol: DeepWikiSymbol,
    context: string,
    abortSignal?: AbortSignal,
  ): Promise<string | undefined> {
    const port = this.settings.devinPort || 3000;
    const langNote =
      this.settings.outputLanguage === "pt-BR"
        ? "\n\nObservação: Por favor, responda em Português Brasileiro (pt-BR)."
        : "";
    const bridgeContext = `${context}${langNote}`;
    try {
      const response = await this.transport(
        `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetDeepWiki`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbolName: symbol.name,
            symbolUri: symbol.uri,
            context: bridgeContext,
            requestType: 1,
          }),
          signal: abortSignal,
        },
      );
      if (!response.ok) return undefined;
      const data = (await response.json()) as {
        rawResponse?: { deltaMessage?: { text?: string } };
      };
      return data?.rawResponse?.deltaMessage?.text || "";
    } catch {
      return undefined;
    }
  }
}

function requestFor(
  kind: Exclude<ProviderKind, "devin_bridge">,
  settings: Settings,
  system: string,
  user: string,
): ChatRequest {
  switch (kind) {
    case "openai":
      return openAiRequest(settings, system, user);
    case "anthropic":
      return anthropicRequest(settings, system, user);
    case "gemini":
      return geminiRequest(settings, system, user);
    case "ollama":
      return ollamaRequest(settings, system, user);
  }
}

async function runRequest(
  transport: Transport,
  req: ChatRequest,
  onDelta: (delta: string) => void,
  abortSignal?: AbortSignal,
): Promise<string> {
  const response = await transport(req.endpoint, {
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

function articleSystemPrompt(language = "en"): string {
  if (language === "pt-BR") {
    return `Você é o DeepWiki, a enciclopédia interativa de código integrada ao espaço de trabalho do desenvolvedor.
Seu propósito é gerar um artigo de documentação arquitetural claro, abrangente e com autoridade técnica para qualquer símbolo de código (função, classe, módulo, interface, variável) no projeto do usuário.

Diretrizes:
1. Forneça uma explicação técnica e precisa das responsabilidades do símbolo, invariantes, entradas e saídas. Responda em Português Brasileiro (pt-BR), mantendo identificadores de código, tipos e nomes de arquivos na forma original.
2. Estruture o artigo de forma limpa com cabeçalhos Markdown:
   - ## Visão Geral e Propósito
   - ## Assinatura e Contrato
   - ## Implementação e Fluxo de Dados
   - ## Uso e Casos de Borda
3. Ao referenciar linhas de código do contexto fornecido, cite-as com precisão com referências de arquivo e linha.
4. No final da sua resposta, você DEVE fornecer exatamente 3 perguntas concisas de acompanhamento em Português Brasileiro para ajudar o desenvolvedor a explorar com mais profundidade. Separe-as usando este delimitador exato:
<!-- DEEPWIKI_FOLLOWUPS -->
- Pergunta 1?
- Pergunta 2?
- Pergunta 3?`;
  }

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

function articleUserPrompt(symbol: DeepWikiSymbol, language = "en"): string {
  if (language === "pt-BR") {
    return `Por favor, documente o seguinte símbolo:

Nome do Símbolo: ${symbol.name}
Tipo do Símbolo: ${symbol.kind}
Arquivo: ${symbol.relativePath} (linhas ${symbol.selectionRange.startLine}:${symbol.selectionRange.startColumn} - ${symbol.selectionRange.endLine}:${symbol.selectionRange.endColumn})
Linguagem: ${symbol.languageId}

Contexto de Código Envolvente:
\`\`\`${symbol.languageId}
${symbol.enclosingCode}
\`\`\`

Gere um artigo completo do DeepWiki para ${symbol.name} em Português Brasileiro.`;
  }

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

function followupSystemPrompt(language = "en"): string {
  if (language === "pt-BR") {
    return `Você é o DeepWiki, o assistente interativo da enciclopédia do espaço de trabalho.
Você está respondendo a uma pergunta de acompanhamento do desenvolvedor sobre um símbolo de código específico e sua arquitetura.

Diretrizes:
1. Forneça uma resposta direta, tecnicamente precisa e focada com base na implementação e contexto do símbolo. Responda em Português Brasileiro (pt-BR), mantendo símbolos de código e identificadores na forma original.
2. Se relevante, inclua trechos de código concisos com o devido realce de sintaxe.
3. Seja claro, sucinto e informativo.`;
  }

  return `You are DeepWiki, the interactive workspace encyclopedia assistant.
You are answering a developer's follow-up question regarding a specific code symbol and its architecture.

Guidelines:
1. Provide a direct, technically accurate, and focused answer based on the symbol's implementation and context.
2. If relevant, include concise code snippets with proper syntax highlighting.
3. Be clear, succinct, and informative.`;
}

function followupUserPrompt(
  symbol: DeepWikiSymbol,
  articleMarkdown: string,
  question: string,
  language = "en",
): string {
  const summarySnippet = articleMarkdown ? articleMarkdown.slice(0, 1500) : "";
  if (language === "pt-BR") {
    return `Contexto - Símbolo de Código:
Nome: ${symbol.name} (${symbol.kind})
Arquivo: ${symbol.relativePath}
Linguagem: ${symbol.languageId}

Código Fonte:
\`\`\`${symbol.languageId}
${symbol.enclosingCode}
\`\`\`

${summarySnippet ? `Resumo do Artigo DeepWiki:\n${summarySnippet}\n` : ""}
Pergunta de Acompanhamento:
${question}

Por favor, responda à pergunta de forma clara e direta em Português Brasileiro.`;
  }

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
