export interface SymbolRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface DeepWikiSymbol {
  name: string;
  kind: string;
  uri: string;
  relativePath: string;
  selectionRange: SymbolRange;
  enclosingCode: string;
  languageId: string;
}

export interface DeepWikiQA {
  id: string;
  question: string;
  answerMarkdown: string;
  modelType?: string;
  isLoading?: boolean;
  error?: string;
}

export interface DeepWikiArticle {
  symbol: DeepWikiSymbol;
  markdown: string;
  followupQuestions: string[];
  modelType: string;
  requestId: string;
  qas?: DeepWikiQA[];
}

export type OutputLanguage = "en" | "pt-BR";

export interface HistoryEntry {
  name: string;
  model: string;
}

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "openFileLocation"; uri: string; line: number; column?: number }
  | { type: "openFileCitation"; path: string; line: number }
  | { type: "followupClick"; question: string; qaId?: string }
  | { type: "askCustomQuestion"; question: string; qaId?: string }
  | { type: "openInHermes"; question: string; answer?: string }
  | { type: "historySelect"; index: number }
  | { type: "copyMarkdown"; markdown: string }
  | { type: "refresh" }
  | { type: "selectModel"; model: string }
  | { type: "addModel"; model: string }
  | { type: "deleteModel"; model: string };

export type ExtensionToWebviewMessage =
  | { type: "setLanguage"; language: OutputLanguage }
  | { type: "setModelState"; currentModel: string; models: string[] }
  | { type: "setSymbol"; symbol: DeepWikiSymbol }
  | { type: "streamDelta"; delta: string }
  | {
      type: "streamComplete";
      fullMarkdown: string;
      followupQuestions: string[];
      modelType: string;
      qas?: DeepWikiQA[];
    }
  | { type: "streamError"; message: string }
  | { type: "setHistoryState"; index: number; entries: HistoryEntry[] }
  | { type: "qaStreamStart"; qaId: string; question: string }
  | { type: "qaStreamDelta"; qaId: string; delta: string }
  | {
      type: "qaStreamComplete";
      qaId: string;
      fullMarkdown: string;
      modelType: string;
    }
  | { type: "qaStreamError"; qaId: string; message: string };
