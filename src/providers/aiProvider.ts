import * as vscode from "vscode";
import { createGenerator, type IAIProvider } from "./generator.ts";
import type { Settings } from "./requests.ts";

export type { DeepWikiGenerationResult, DeepWikiQuestionResult, IAIProvider } from "./generator.ts";

function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration("deepwiki");
  return {
    providerType: config.get<string>("provider", "auto"),
    apiKey: config.get<string>("apiKey", ""),
    baseUrl: config.get<string>("apiBaseUrl", ""),
    model: config.get<string>("model", ""),
    devinPort: config.get<number>("devinBridgePort", 0),
    outputLanguage: config.get<string>("outputLanguage", "en"),
  };
}

export class AIProviderFactory {
  public static createProvider(): IAIProvider {
    return createGenerator(readSettings());
  }
}
