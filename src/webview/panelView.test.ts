import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepWikiSymbol } from "../types.ts";
import { applyHostMessage, initialPanelView } from "./panelView.ts";

const symbol: DeepWikiSymbol = {
  name: "Foo",
  kind: "Function",
  uri: "file:///src/a.ts",
  relativePath: "src/a.ts",
  selectionRange: { startLine: 4, startColumn: 1, endLine: 6, endColumn: 2 },
  enclosingCode: "function Foo() {}",
  languageId: "typescript",
};

test("host messages become one panel state", () => {
  let view = initialPanelView();
  assert.equal(view.showWelcome, true);
  assert.equal(view.header.name, "DeepWiki");

  view = applyHostMessage(view, { type: "setSymbol", symbol });
  assert.equal(view.showWelcome, false);
  assert.equal(view.showSkeleton, true);
  assert.equal(view.showBody, false);
  assert.equal(view.header.name, "Foo");
  assert.equal(view.header.kind, "Function");
  assert.equal(view.header.location, "src/a.ts#4");
  assert.equal(view.streaming, true);

  view = applyHostMessage(view, { type: "streamDelta", delta: "Hel" });
  view = applyHostMessage(view, { type: "streamDelta", delta: "lo" });
  assert.equal(view.markdown, "Hello");
  assert.equal(view.showSkeleton, false);
  assert.equal(view.showBody, true);

  view = applyHostMessage(view, {
    type: "streamComplete",
    fullMarkdown: "Hello\n",
    followupQuestions: ["Why?"],
    modelType: "fake",
    qas: [
      {
        id: "old",
        question: "Earlier?",
        answerMarkdown: "yes",
        modelType: "fake",
      },
    ],
  });
  assert.equal(view.streaming, false);
  assert.equal(view.markdown, "Hello\n");
  assert.deepEqual(view.followups, ["Why?"]);
  assert.equal(view.modelBadge, "fake");
  assert.equal(view.qas.length, 1);
  assert.equal(view.qas[0]?.status, "complete");
  assert.equal(view.qas[0]?.markdown, "yes");

  view = applyHostMessage(view, { type: "qaStreamStart", qaId: "qa-1", question: "Why?" });
  view = applyHostMessage(view, { type: "qaStreamDelta", qaId: "qa-1", delta: "Be" });
  view = applyHostMessage(view, { type: "qaStreamDelta", qaId: "qa-1", delta: "cause" });
  assert.equal(view.qas[1]?.status, "streaming");
  assert.equal(view.qas[1]?.markdown, "Because");

  view = applyHostMessage(view, {
    type: "qaStreamComplete",
    qaId: "qa-1",
    fullMarkdown: "Because.",
    modelType: "fake",
  });
  assert.equal(view.qas[1]?.status, "complete");
  assert.equal(view.qas[1]?.markdown, "Because.");
  assert.equal(view.qas[1]?.modelType, "fake");

  view = applyHostMessage(view, { type: "setHistoryState", hasBack: true, hasForward: false });
  assert.deepEqual(view.history, { hasBack: true, hasForward: false });

  view = applyHostMessage(view, { type: "qaStreamError", qaId: "qa-1", message: "nope" });
  assert.equal(view.qas[1]?.status, "error");
  assert.equal(view.qas[1]?.error, "nope");

  view = applyHostMessage(view, { type: "streamError", message: "down" });
  assert.equal(view.error, "down");
  assert.equal(view.streaming, false);
  assert.deepEqual(view.followups, []);

  view = applyHostMessage(view, { type: "setSymbol", symbol });
  assert.equal(view.markdown, "");
  assert.equal(view.error, null);
  assert.deepEqual(view.qas, []);
  assert.deepEqual(view.followups, []);
});

test("a delta after the article completes does not change the body", () => {
  let view = applyHostMessage(initialPanelView(), { type: "setSymbol", symbol });
  view = applyHostMessage(view, {
    type: "streamComplete",
    fullMarkdown: "Done",
    followupQuestions: [],
    modelType: "fake",
  });
  view = applyHostMessage(view, { type: "streamDelta", delta: "late" });
  assert.equal(view.markdown, "Done");
});

test("setLanguage updates the panel language and localized headers", () => {
  let view = initialPanelView();
  assert.equal(view.language, "en");
  assert.equal(view.header.kind, "Encyclopedia");
  assert.equal(view.header.location, "No symbol selected");

  view = applyHostMessage(view, { type: "setLanguage", language: "pt-BR" });
  assert.equal(view.language, "pt-BR");
  assert.equal(view.header.kind, "Enciclopédia");
  assert.equal(view.header.location, "Nenhum símbolo selecionado");

  view = applyHostMessage(view, { type: "setSymbol", symbol });
  assert.equal(view.header.name, "Foo");
  assert.equal(view.header.kind, "Função");

  view = applyHostMessage(view, { type: "setLanguage", language: "en" });
  assert.equal(view.language, "en");
  assert.equal(view.header.kind, "Function");
});
