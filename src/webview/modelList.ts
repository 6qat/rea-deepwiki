export const DEFAULT_MODEL = "llama3.2";

export interface ModelState {
  currentModel: string;
  models: string[];
}

export function normalizeModelState(
  currentModel: string,
  savedModels: readonly string[],
): ModelState {
  const models: string[] = [];
  const seen = new Set<string>();

  for (const raw of savedModels) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push(trimmed);
  }

  const trimmedCurrent = currentModel.trim();
  const active = trimmedCurrent || models[0] || DEFAULT_MODEL;
  if (!seen.has(active)) {
    models.push(active);
  }

  return { currentModel: active, models };
}

export function selectModel(state: ModelState, model: string): ModelState {
  const trimmed = model.trim();
  if (!trimmed) return state;
  return normalizeModelState(trimmed, state.models);
}

export function addModel(state: ModelState, model: string): ModelState {
  const trimmed = model.trim();
  if (!trimmed) return state;
  return normalizeModelState(trimmed, [...state.models, trimmed]);
}

export function deleteModel(state: ModelState, model: string): ModelState {
  const target = model.trim();
  if (!target) return state;
  const remaining = state.models.filter((item) => item !== target);
  const nextCurrent =
    state.currentModel === target ? (remaining[0] ?? DEFAULT_MODEL) : state.currentModel;
  return normalizeModelState(nextCurrent, remaining);
}
