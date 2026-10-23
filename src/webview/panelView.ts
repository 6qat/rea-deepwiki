import type { DeepWikiQA, DeepWikiSymbol, ExtensionToWebviewMessage } from "../types.ts";

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
  history: { hasBack: boolean; hasForward: boolean };
}

const welcomeHeader: PanelHeader = {
  name: "DeepWiki",
  kind: "Encyclopedia",
  location: "No symbol selected",
};

export function initialPanelView(): PanelView {
  return {
    showWelcome: true,
    showArticle: false,
    showSkeleton: false,
    showBody: false,
    streaming: false,
    header: welcomeHeader,
    symbol: null,
    modelBadge: null,
    markdown: "",
    error: null,
    followups: [],
    qas: [],
    history: { hasBack: false, hasForward: false },
  };
}

export function applyHostMessage(view: PanelView, message: ExtensionToWebviewMessage): PanelView {
  switch (message.type) {
    case "setSymbol":
      return {
        ...view,
        showWelcome: false,
        showArticle: true,
        showSkeleton: true,
        showBody: false,
        streaming: true,
        header: headerFor(message.symbol),
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
        history: { hasBack: message.hasBack, hasForward: message.hasForward },
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

function headerFor(symbol: DeepWikiSymbol): PanelHeader {
  return {
    name: symbol.name,
    kind: symbol.kind,
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
