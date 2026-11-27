/**
 * Reads the JSON value a chat model returned for an AI request.
 *
 * Models often wrap a usable answer in text a strict parser rejects: a leading
 * reasoning block (<think>…</think>, or Gemma 4's <|channel>thought…<channel|>
 * even with thinking off), prose before a code fence, a note after it, a
 * trailing comma, or a fence whose final brace is missing. The strict parse
 * runs first. Only when it fails does the repair look for the first JSON value,
 * drop the text around it and trailing commas, and close brackets still open
 * at the end when the text stops right after a closed object or list. It adds
 * no values, so an answer cut inside an item or before its first item stays
 * unreadable and keeps the caller's malformed-output handling.
 */
export function parseModelJson(text: string): unknown {
  const answer = stripLeadingReasoning(text);
  try {
    return JSON.parse(stripWholeCodeFence(answer));
  } catch (error) {
    const repaired = repairedJson(answer);
    if (repaired.found) return repaired.value;
    throw error;
  }
}

const LEADING_REASONING_BLOCK = /^(?:<think>[\s\S]*?<\/think>|<\|channel>[\s\S]*?<channel\|>)\s*/i;
const WHOLE_CODE_FENCE = /^`{3}(?:json)?\s*([\s\S]*?)\s*`{3}$/i;
const CODE_FENCE_MARKER = /`{3}(?:json)?/gi;
const MAX_REPAIR_STARTS = 16;

function stripLeadingReasoning(text: string): string {
  let rest = text.trim();
  for (let next = rest.replace(LEADING_REASONING_BLOCK, ""); next !== rest; next = rest.replace(LEADING_REASONING_BLOCK, "")) {
    rest = next.trim();
  }
  return rest;
}

function stripWholeCodeFence(text: string): string {
  return text.match(WHOLE_CODE_FENCE)?.[1]?.trim() ?? text;
}

function repairedJson(text: string): { readonly found: true; readonly value: unknown } | { readonly found: false } {
  const unfenced = text.replace(CODE_FENCE_MARKER, "");
  let start = unfenced.search(/[[{]/);
  for (let attempt = 0; start >= 0 && attempt < MAX_REPAIR_STARTS; attempt += 1) {
    const candidate = firstJsonValue(unfenced, start);
    if (candidate !== null) {
      try {
        return { found: true, value: JSON.parse(candidate) };
      } catch {
        // Try the next opening bracket: prose such as "[10 items]" can come first.
      }
    }
    const next = unfenced.slice(start + 1).search(/[[{]/);
    start = next < 0 ? -1 : start + 1 + next;
  }
  return { found: false };
}

/**
 * The JSON value starting at start, without trailing commas, ending where its
 * outermost bracket closes. Brackets left open at the end of the text are
 * closed when it ends with a closed object or list. Null when the brackets do
 * not match or the text ends anywhere else.
 */
function firstJsonValue(text: string, start: number): string | null {
  const closers: string[] = [];
  let value = "";
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (inString) {
      value += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      value += character;
    } else if (character === "{" || character === "[") {
      closers.push(character === "{" ? "}" : "]");
      value += character;
    } else if (character === "}" || character === "]") {
      if (closers.pop() !== character) return null;
      value = withoutTrailingComma(value) + character;
      if (closers.length === 0) return value;
    } else {
      value += character;
    }
  }
  const complete = withoutTrailingComma(value).trimEnd();
  if (inString || !(complete.endsWith("}") || complete.endsWith("]"))) return null;
  return complete + closers.reverse().join("");
}

function withoutTrailingComma(value: string): string {
  return value.replace(/,\s*$/, "");
}
