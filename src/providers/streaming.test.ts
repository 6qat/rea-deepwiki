import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseFollowupQuestions,
  parseOllamaDelta,
  parseOpenAiDelta,
  streamLines,
} from "./streaming.ts";

function responseOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

const sse = (content: string) =>
  `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}`;

async function collect(chunks: string[], parseLine = parseOpenAiDelta) {
  const deltas: string[] = [];
  const text = await streamLines(responseOf(chunks), (delta) => deltas.push(delta), parseLine);
  return { text, deltas };
}

test("reassembles a line split across chunks", async () => {
  const line = sse("Hello");
  const { text } = await collect([line.slice(0, 20), `${line.slice(20)}\n`]);
  assert.equal(text, "Hello");
});

test("keeps the last line when the stream ends without a newline", async () => {
  const { text } = await collect([`${sse("Hello ")}\n\n${sse("world")}`]);
  assert.equal(text, "Hello world");
});

test("ignores comments and [DONE]", async () => {
  const { text } = await collect([`: ping\n\n${sse("a")}\n\ndata: [DONE]\n\n`]);
  assert.equal(text, "a");
});

test("reads Ollama's newline-delimited JSON", async () => {
  const { text } = await collect(['{"response":"Hi"}\n{"response":" there"}'], parseOllamaDelta);
  assert.equal(text, "Hi there");
});

test("splits follow-up questions off the article", () => {
  const { markdown, questions } = parseFollowupQuestions(
    "## Body\n\ntext\n\n<!-- DEEPWIKI_FOLLOWUPS -->\n- Why this order?\n- What if it fails?\n- Who calls it?",
  );
  assert.equal(markdown, "## Body\n\ntext");
  assert.deepEqual(questions, ["Why this order?", "What if it fails?", "Who calls it?"]);
});

test("keeps a short follow-up question", () => {
  const { questions } = parseFollowupQuestions(
    "body\n<!-- DEEPWIKI_FOLLOWUPS -->\n- Why?\n-\n- How does it fail?",
  );
  assert.deepEqual(questions, ["Why?", "How does it fail?"]);
});
