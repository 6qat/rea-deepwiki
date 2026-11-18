import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addModel,
  DEFAULT_MODEL,
  deleteModel,
  normalizeModelState,
  selectModel,
} from "./modelList.ts";

test("normalizeModelState initializes with only the configured current model when saved list is empty", () => {
  assert.deepEqual(normalizeModelState("gpt-4o", []), {
    currentModel: "gpt-4o",
    models: ["gpt-4o"],
  });

  assert.deepEqual(normalizeModelState("", []), {
    currentModel: DEFAULT_MODEL,
    models: [DEFAULT_MODEL],
  });
});

test("normalizeModelState deduplicates, trims, and ensures current model is included", () => {
  assert.deepEqual(
    normalizeModelState(" claude-3-5-sonnet-latest ", [" llama3.2 ", "", "llama3.2"]),
    {
      currentModel: "claude-3-5-sonnet-latest",
      models: ["llama3.2", "claude-3-5-sonnet-latest"],
    },
  );
});

test("addModel appends a new model without duplicating and selects it", () => {
  const initial = { currentModel: "llama3.2", models: ["llama3.2"] };

  const added = addModel(initial, " gpt-4o ");
  assert.deepEqual(added, {
    currentModel: "gpt-4o",
    models: ["llama3.2", "gpt-4o"],
  });

  const duplicate = addModel(added, "llama3.2");
  assert.deepEqual(duplicate, {
    currentModel: "llama3.2",
    models: ["llama3.2", "gpt-4o"],
  });

  assert.deepEqual(addModel(added, "   "), added);
});

test("selectModel switches active model and ignores blank input", () => {
  const initial = { currentModel: "llama3.2", models: ["llama3.2", "gpt-4o"] };
  assert.deepEqual(selectModel(initial, "gpt-4o"), {
    currentModel: "gpt-4o",
    models: ["llama3.2", "gpt-4o"],
  });
  assert.deepEqual(selectModel(initial, ""), initial);
});

test("deleteModel removes inactive model without changing active selection", () => {
  const initial = {
    currentModel: "gpt-4o",
    models: ["llama3.2", "gpt-4o", "gemini-2.0-flash"],
  };
  assert.deepEqual(deleteModel(initial, "llama3.2"), {
    currentModel: "gpt-4o",
    models: ["gpt-4o", "gemini-2.0-flash"],
  });
});

test("deleteModel falls back to first remaining model or default when deleting active model", () => {
  const two = { currentModel: "gpt-4o", models: ["gpt-4o", "gemini-2.0-flash"] };
  assert.deepEqual(deleteModel(two, "gpt-4o"), {
    currentModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash"],
  });

  const one = { currentModel: "gpt-4o", models: ["gpt-4o"] };
  assert.deepEqual(deleteModel(one, "gpt-4o"), {
    currentModel: DEFAULT_MODEL,
    models: [DEFAULT_MODEL],
  });
});
