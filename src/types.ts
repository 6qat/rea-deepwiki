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

export interface DeepWikiArticle {
  symbol: DeepWikiSymbol;
  markdown: string;
  followupQuestions: string[];
  modelType: string;
  requestId: string;
}

export type WebviewToExtensionMessage =
  | { type: "openFileLocation"; uri: string; line: number; column?: number }
  | { type: "openFileCitation"; path: string; line: number }
  | { type: "followupClick"; question: string }
  | { type: "historyBack" }
  | { type: "historyForward" }
  | { type: "copyMarkdown"; markdown: string }
  | { type: "refresh" }
  | { type: "searchSymbol"; query: string };

export type ExtensionToWebviewMessage =
  | { type: "setSymbol"; symbol: DeepWikiSymbol }
  | { type: "streamDelta"; delta: string }
  | {
      type: "streamComplete";
      fullMarkdown: string;
      followupQuestions: string[];
      modelType: string;
    }
  | { type: "streamError"; message: string }
  | { type: "setHistoryState"; hasBack: boolean; hasForward: boolean };
