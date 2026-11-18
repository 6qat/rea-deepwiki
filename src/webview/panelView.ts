import type {
  DeepWikiQA,
  DeepWikiSymbol,
  ExtensionToWebviewMessage,
  HistoryEntry,
  OutputLanguage,
} from "../types.ts";
import { DEFAULT_MODEL, type ModelState, normalizeModelState } from "./modelList.ts";

export interface PanelHeader {
  name: string;
  kind: string;
  location: string;
}

export interface PanelQa {
  id: string;
  question: string;
  markdown: string;
  modelType: string | null;
  status: "streaming" | "complete" | "error";
  error: string | null;
}

export interface PanelStrings {
  tagEncyclopedia: string;
  noSymbolSelected: string;
  history: string;
  copyMarkdown: string;
  refresh: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  welcomeShortcut: string;
  welcomeRightClick: string;
  exploreFurther: string;
  askQuestionPlaceholder: string;
  sendQuestion: string;
  askInline: string;
  answering: string;
  followupAnswers: string;
  generatingAnswer: string;
  copy: string;
  copied: string;
  retry: string;
  generationError: string;
  errorPrefix: string;
  continueInHermes: string;
  hermesLabel: string;
  selectModel: string;
  addModelPlaceholder: string;
  addModel: string;
  deleteModel: string;
}

export const PANEL_STRINGS: Record<OutputLanguage, PanelStrings> = {
  en: {
    tagEncyclopedia: "Encyclopedia",
    noSymbolSelected: "No symbol selected",
    history: "Researched terms",
    copyMarkdown: "Copy Markdown",
    refresh: "Refresh",
    welcomeTitle: "Welcome to DeepWiki",
    welcomeSubtitle:
      "Interactive code encyclopedia for your codebase. Explore symbols, architecture, and contracts.",
    welcomeShortcut: "on any symbol",
    welcomeRightClick:
      "Right-click any function, class, or variable &rarr; <em>Open Symbol in DeepWiki</em>",
    exploreFurther: "Explore Further",
    askQuestionPlaceholder: "Ask a question about this symbol...",
    sendQuestion: "Send question",
    askInline: "Ask inline &darr;",
    answering: "Answering...",
    followupAnswers: "Follow-up Answers",
    generatingAnswer: "Generating answer...",
    copy: "Copy",
    copied: "Copied!",
    retry: "Retry",
    generationError: "DeepWiki Generation Error",
    errorPrefix: "Error:",
    continueInHermes: "Continue in Hermes Studio",
    hermesLabel: "Hermes ↗",
    selectModel: "Select model",
    addModelPlaceholder: "New model name...",
    addModel: "Add model",
    deleteModel: "Remove model",
  },
  "pt-BR": {
    tagEncyclopedia: "Enciclopédia",
    noSymbolSelected: "Nenhum símbolo selecionado",
    history: "Termos pesquisados",
    copyMarkdown: "Copiar Markdown",
    refresh: "Atualizar",
    welcomeTitle: "Bem-vindo ao DeepWiki",
    welcomeSubtitle:
      "Enciclopédia interativa de código para seu projeto. Explore símbolos, arquitetura e contratos.",
    welcomeShortcut: "em qualquer símbolo",
    welcomeRightClick:
      "Clique com o botão direito em qualquer função, classe ou variável &rarr; <em>Abrir Símbolo no DeepWiki</em>",
    exploreFurther: "Explorar Mais",
    askQuestionPlaceholder: "Faça uma pergunta sobre este símbolo...",
    sendQuestion: "Enviar pergunta",
    askInline: "Perguntar aqui &darr;",
    answering: "Respondendo...",
    followupAnswers: "Respostas de Acompanhamento",
    generatingAnswer: "Gerando resposta...",
    copy: "Copiar",
    copied: "Copiado!",
    retry: "Tentar novamente",
    generationError: "Erro ao Gerar Artigo no DeepWiki",
    errorPrefix: "Erro:",
    continueInHermes: "Continuar no Hermes Studio",
    hermesLabel: "Hermes ↗",
    selectModel: "Selecionar modelo",
    addModelPlaceholder: "Novo modelo...",
    addModel: "Adicionar modelo",
    deleteModel: "Remover modelo",
  },
};

export function getPanelStrings(lang: OutputLanguage = "en"): PanelStrings {
  return PANEL_STRINGS[lang] ?? PANEL_STRINGS.en;
}

const KIND_TRANSLATIONS: Record<string, string> = {
  Function: "Função",
  Class: "Classe",
  Interface: "Interface",
  Variable: "Variável",
  Diagnostic: "Diagnóstico",
  "Follow-up": "Acompanhamento",
  Method: "Método",
  Property: "Propriedade",
  Constructor: "Construtor",
  Enum: "Enum",
  Module: "Módulo",
  Namespace: "Namespace",
  Package: "Pacote",
  String: "Texto",
  Number: "Número",
  Boolean: "Booleano",
  Array: "Array",
  Object: "Objeto",
  Key: "Chave",
  Null: "Nulo",
  EnumMember: "Membro de Enum",
  Struct: "Estrutura",
  Event: "Evento",
  Operator: "Operador",
  TypeParameter: "Parâmetro de Tipo",
};

export function kindLabel(kind: string, lang: OutputLanguage = "en"): string {
  if (lang === "pt-BR") {
    return KIND_TRANSLATIONS[kind] ?? kind;
  }
  return kind;
}

/** What the panel shows after one host message. The page only paints this. */
export interface PanelView {
  showWelcome: boolean;
  showArticle: boolean;
  showSkeleton: boolean;
  showBody: boolean;
  streaming: boolean;
  header: PanelHeader;
  symbol: DeepWikiSymbol | null;
  modelBadge: string | null;
  markdown: string;
  error: string | null;
  followups: string[];
  qas: PanelQa[];
  history: {
    index: number;
    entries: HistoryEntry[];
  };
  modelState: ModelState;
  language: OutputLanguage;
}

function welcomeHeader(lang: OutputLanguage = "en"): PanelHeader {
  const strings = getPanelStrings(lang);
  return {
    name: "DeepWiki",
    kind: strings.tagEncyclopedia,
    location: strings.noSymbolSelected,
  };
}

export function initialPanelView(lang: OutputLanguage = "en"): PanelView {
  return {
    showWelcome: true,
    showArticle: false,
    showSkeleton: false,
    showBody: false,
    streaming: false,
    header: welcomeHeader(lang),
    symbol: null,
    modelBadge: null,
    markdown: "",
    error: null,
    followups: [],
    qas: [],
    history: { index: -1, entries: [] },
    modelState: { currentModel: DEFAULT_MODEL, models: [DEFAULT_MODEL] },
    language: lang,
  };
}

export function applyHostMessage(view: PanelView, message: ExtensionToWebviewMessage): PanelView {
  switch (message.type) {
    case "setLanguage":
      return {
        ...view,
        language: message.language,
        header: view.symbol
          ? headerFor(view.symbol, message.language)
          : welcomeHeader(message.language),
      };
    case "setModelState":
      return {
        ...view,
        modelState: normalizeModelState(message.currentModel, message.models),
      };
    case "setSymbol":
      return {
        ...view,
        showWelcome: false,
        showArticle: true,
        showSkeleton: true,
        showBody: false,
        streaming: true,
        header: headerFor(message.symbol, view.language),
        symbol: message.symbol,
        modelBadge: null,
        markdown: "",
        error: null,
        followups: [],
        qas: [],
      };
    case "streamDelta":
      if (!view.streaming) return view;
      return {
        ...view,
        showSkeleton: false,
        showBody: true,
        markdown: view.markdown + message.delta,
      };
    case "streamComplete":
      return {
        ...view,
        showWelcome: false,
        showArticle: true,
        showSkeleton: false,
        showBody: true,
        streaming: false,
        modelBadge: message.modelType || null,
        markdown: message.fullMarkdown,
        error: null,
        followups: message.followupQuestions,
        qas: (message.qas ?? []).map(completeQa),
      };
    case "streamError":
      return {
        ...view,
        showSkeleton: false,
        showBody: true,
        streaming: false,
        error: message.message,
        followups: [],
      };
    case "setHistoryState":
      return {
        ...view,
        history: { index: message.index, entries: message.entries },
      };
    case "qaStreamStart":
      return {
        ...view,
        qas: [
          ...view.qas.filter((qa) => qa.id !== message.qaId),
          {
            id: message.qaId,
            question: message.question,
            markdown: "",
            modelType: null,
            status: "streaming",
            error: null,
          },
        ],
      };
    case "qaStreamDelta":
      return {
        ...view,
        qas: view.qas.map((qa) =>
          qa.id === message.qaId ? { ...qa, markdown: qa.markdown + message.delta } : qa,
        ),
      };
    case "qaStreamComplete":
      return {
        ...view,
        qas: view.qas.map((qa) =>
          qa.id === message.qaId
            ? {
                ...qa,
                markdown: message.fullMarkdown,
                modelType: message.modelType || null,
                status: "complete",
                error: null,
              }
            : qa,
        ),
      };
    case "qaStreamError":
      return {
        ...view,
        qas: view.qas.map((qa) =>
          qa.id === message.qaId ? { ...qa, status: "error", error: message.message } : qa,
        ),
      };
  }
}

function headerFor(symbol: DeepWikiSymbol, lang: OutputLanguage = "en"): PanelHeader {
  return {
    name: symbol.name,
    kind: kindLabel(symbol.kind, lang),
    location: `${symbol.relativePath}#${symbol.selectionRange.startLine}`,
  };
}

function completeQa(qa: DeepWikiQA): PanelQa {
  return {
    id: qa.id,
    question: qa.question,
    markdown: qa.answerMarkdown,
    modelType: qa.modelType ?? null,
    status: qa.error ? "error" : "complete",
    error: qa.error ?? null,
  };
}
