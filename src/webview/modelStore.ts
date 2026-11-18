import {
  addModel,
  deleteModel,
  type ModelState,
  normalizeModelState,
  selectModel,
} from "./modelList.ts";

export interface ModelConfigSnapshot {
  currentModel: string;
  savedModels: readonly string[];
  hasExplicitSavedModels: boolean;
}

export interface ModelStoreBackend {
  readConfig(): ModelConfigSnapshot;
  writeModels(models: string[]): Promise<void>;
  writeCurrentModel(model: string): Promise<void>;
  readFallbackModels(): readonly string[];
  writeFallbackModels(models: readonly string[]): Promise<void>;
}

/**
 * Persists the active model and saved model list in settings, writing `models`
 * before `model` so intermediate config-change reads never drop existing items,
 * and falling back to extension state if `deepwiki.models` cannot be written.
 */
export class ModelStore {
  private readonly backend: ModelStoreBackend;

  constructor(backend: ModelStoreBackend) {
    this.backend = backend;
  }

  public readState(): ModelState {
    const config = this.backend.readConfig();
    const models = config.hasExplicitSavedModels
      ? config.savedModels
      : this.backend.readFallbackModels();
    return normalizeModelState(config.currentModel, models);
  }

  public async select(model: string): Promise<ModelState> {
    const current = this.readState();
    const next = selectModel(current, model);
    await this.persist(next);
    return next;
  }

  public async add(model: string): Promise<ModelState> {
    const current = this.readState();
    const next = addModel(current, model);
    await this.persist(next);
    return next;
  }

  public async delete(model: string): Promise<ModelState> {
    const current = this.readState();
    const next = deleteModel(current, model);
    await this.persist(next);
    return next;
  }

  private async persist(next: ModelState): Promise<void> {
    const config = this.backend.readConfig();
    const modelsAlreadySynced =
      config.hasExplicitSavedModels && arraysEqual(config.savedModels, next.models);

    if (!modelsAlreadySynced) {
      try {
        await this.backend.writeModels(next.models);
        if (this.backend.readFallbackModels().length > 0 || !config.hasExplicitSavedModels) {
          await this.backend.writeFallbackModels([]);
        }
      } catch {
        await this.backend.writeFallbackModels(next.models);
      }
    }

    if (config.currentModel.trim() !== next.currentModel) {
      await this.backend.writeCurrentModel(next.currentModel);
    }
  }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
