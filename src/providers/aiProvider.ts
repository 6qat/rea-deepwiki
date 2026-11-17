import * as vscode from "vscode";
import { createGenerator, type IAIProvider } from "./generator.ts";
import { resolvedArticleModel, type Settings } from "./requests.ts";

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

/** Model name the next article would be labeled with. Empty when settings cannot be resolved. */
export function currentArticleModel(): string {
  try {
    return resolvedArticleModel(readSettings());
  } catch {
    return "";
  }
}

export class AIProviderFactory {
  public static createProvider(model?: string): IAIProvider {
    const settings = readSettings();
    if (model === "Devin Local Bridge") {
      return createGenerator({ ...settings, providerType: "devin_bridge" });
    }
    if (model) return createGenerator({ ...settings, modelOverride: model });
    return createGenerator(settings);
  }
}
