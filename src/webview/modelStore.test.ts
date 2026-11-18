import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelStore, type ModelStoreBackend } from "./modelStore.ts";

function fakeBackend(
  options: {
    currentModel?: string;
    savedModels?: string[];
    hasExplicitSavedModels?: boolean;
    failWriteModels?: boolean;
    onWriteStep?: (step: string, state: { currentModel: string; savedModels: string[] }) => void;
  } = {},
) {
  let currentModel = options.currentModel ?? "llama3.2";
  let savedModels = [...(options.savedModels ?? [])];
  let hasExplicitSavedModels = options.hasExplicitSavedModels ?? false;
  let fallbackModels: string[] = [];
  const operations: string[] = [];

  const backend: ModelStoreBackend = {
    readConfig: () => ({
      currentModel,
      savedModels,
      hasExplicitSavedModels,
    }),
    writeModels: async (models) => {
      operations.push(`writeModels:${JSON.stringify(models)}`);
      if (options.failWriteModels) {
        throw new Error("deepwiki.models is not a registered configuration");
      }
      savedModels = [...models];
      hasExplicitSavedModels = true;
      options.onWriteStep?.("writeModels", { currentModel, savedModels: [...savedModels] });
    },
    writeCurrentModel: async (model) => {
      operations.push(`writeCurrentModel:${model}`);
      currentModel = model;
      options.onWriteStep?.("writeCurrentModel", { currentModel, savedModels: [...savedModels] });
    },
    readFallbackModels: () => fallbackModels,
    writeFallbackModels: async (models) => {
      operations.push(`writeFallbackModels:${JSON.stringify(models)}`);
      fallbackModels = [...models];
    },
  };

  return {
    backend,
    operations,
    getFallback: () => [...fallbackModels],
  };
}

test("add persists models before currentModel so intermediate reads never lose the previous model", async () => {
  const seenDuringWrites: Array<{ currentModel: string; models: string[] }> = [];
  let store: ModelStore;

  const { backend, operations } = fakeBackend({
    currentModel: "qwen3:8b",
    onWriteStep: () => {
      seenDuringWrites.push(store.readState());
    },
  });
  store = new ModelStore(backend);

  const next = await store.add("gpt-4o");

  assert.deepEqual(next, {
    currentModel: "gpt-4o",
    models: ["qwen3:8b", "gpt-4o"],
  });
  assert.deepEqual(operations, [
    'writeModels:["qwen3:8b","gpt-4o"]',
    "writeFallbackModels:[]",
    "writeCurrentModel:gpt-4o",
  ]);
  assert.deepEqual(seenDuringWrites, [
    { currentModel: "qwen3:8b", models: ["qwen3:8b", "gpt-4o"] },
    { currentModel: "gpt-4o", models: ["qwen3:8b", "gpt-4o"] },
  ]);
});

test("add preserves the previous model in fallback storage when writeModels fails", async () => {
  const { backend } = fakeBackend({
    currentModel: "qwen3:8b",
    failWriteModels: true,
  });
  const store = new ModelStore(backend);

  const afterFirstAdd = await store.add("gpt-4o");
  assert.deepEqual(afterFirstAdd, {
    currentModel: "gpt-4o",
    models: ["qwen3:8b", "gpt-4o"],
  });
  assert.deepEqual(store.readState(), {
    currentModel: "gpt-4o",
    models: ["qwen3:8b", "gpt-4o"],
  });

  const afterSecondAdd = await store.add("claude-3-5-sonnet-latest");
  assert.deepEqual(afterSecondAdd, {
    currentModel: "claude-3-5-sonnet-latest",
    models: ["qwen3:8b", "gpt-4o", "claude-3-5-sonnet-latest"],
  });
  assert.deepEqual(store.readState(), {
    currentModel: "claude-3-5-sonnet-latest",
    models: ["qwen3:8b", "gpt-4o", "claude-3-5-sonnet-latest"],
  });
});

test("delete updates fallback storage when writeModels fails and falls back cleanly", async () => {
  const { backend } = fakeBackend({
    currentModel: "qwen3:8b",
    failWriteModels: true,
  });
  const store = new ModelStore(backend);

  await store.add("gpt-4o");
  const afterDelete = await store.delete("gpt-4o");

  assert.deepEqual(afterDelete, {
    currentModel: "qwen3:8b",
    models: ["qwen3:8b"],
  });
  assert.deepEqual(store.readState(), {
    currentModel: "qwen3:8b",
    models: ["qwen3:8b"],
  });
});

test("explicit savedModels in settings takes precedence over stale fallback storage", async () => {
  const { backend } = fakeBackend({
    currentModel: "gpt-4o",
    savedModels: ["llama3.2", "gpt-4o"],
    hasExplicitSavedModels: true,
  });
  await backend.writeFallbackModels(["stale-model"]);
  const store = new ModelStore(backend);

  assert.deepEqual(store.readState(), {
    currentModel: "gpt-4o",
    models: ["llama3.2", "gpt-4o"],
  });
});

test("select switches currentModel without rewriting identical savedModels", async () => {
  const { backend, operations } = fakeBackend({
    currentModel: "llama3.2",
    savedModels: ["llama3.2", "gpt-4o"],
    hasExplicitSavedModels: true,
  });
  const store = new ModelStore(backend);

  const next = await store.select("gpt-4o");
  assert.deepEqual(next, {
    currentModel: "gpt-4o",
    models: ["llama3.2", "gpt-4o"],
  });
  assert.deepEqual(operations, ["writeCurrentModel:gpt-4o"]);
});
