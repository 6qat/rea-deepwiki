export type DeltaParser = (line: string) => string | undefined;

/**
 * Reads a text stream line by line, feeds each line to `parseLine`, and returns
 * every delta that parser emitted. The trailing partial line is flushed even when
 * the stream closes without a final newline.
 */
export async function streamLines(
  response: Response,
  onDelta: (delta: string) => void,
  parseLine: DeltaParser,
): Promise<string> {
  if (!response.body) {
    throw new Error("No response body received.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  const handle = (line: string) => {
    const delta = parseLine(line);
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      handle(line);
    }
  }

  handle(buffer);
  return fullText;
}

export function parseFollowupQuestions(text: string): {
  markdown: string;
  questions: string[];
} {
  const delimiter = "<!-- DEEPWIKI_FOLLOWUPS -->";
  const index = text.indexOf(delimiter);
  if (index === -1) {
    return { markdown: text, questions: [] };
  }

  const markdown = text.substring(0, index).trim();
  const followupSection = text.substring(index + delimiter.length).trim();

  const questions: string[] = [];
  const lines = followupSection.split("\n");
  for (let line of lines) {
    line = line.replace(/^\s*[-*•\d.]+\s*/, "").trim();
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).trim();
    }
    if (line.length > 2) {
      questions.push(line);
    }
  }

  return {
    markdown,
    questions: questions.slice(0, 3),
  };
}

/** Payload of a `data: {...}` line, or undefined for blanks, comments and `[DONE]`. */
function ssePayload(line: string): any {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") return undefined;
  try {
    return JSON.parse(trimmed.slice(6));
  } catch {
    return undefined;
  }
}

export const parseOpenAiDelta: DeltaParser = (line) =>
  ssePayload(line)?.choices?.[0]?.delta?.content;

export const parseAnthropicDelta: DeltaParser = (line) => {
  const json = ssePayload(line);
  return json?.type === "content_block_delta" ? json.delta?.text : undefined;
};

export const parseGeminiDelta: DeltaParser = (line) =>
  ssePayload(line)?.candidates?.[0]?.content?.parts?.[0]?.text;

export const parseOllamaDelta: DeltaParser = (line) => {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line)?.response;
  } catch {
    return undefined;
  }
};
