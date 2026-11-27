import { describe, expect, it } from "vitest";
import { parseModelJson } from "./modelJson";

const item = { id: "a", category: "workspace", intent: "work_execution", confidence: 0.9, reason: "Editing the launch plan" };
const answer = { results: [item, { ...item, id: "b" }] };
const json = JSON.stringify(answer);
const missingFinalBrace = json.slice(0, -1);

describe("parseModelJson", () => {
  it.each([
    ["a plain answer", json],
    ["a whole code fence", "```json\n" + json + "\n```"],
    ["Gemma 4's empty channel block", "<|channel>thought\n<channel|>" + json],
    ["a think block before a fence missing its final brace", "<think>\n\n</think>\n\n```json\n" + missingFinalBrace + "\n```"],
    ["prose before a fence", "Here are the classifications:\n```json\n" + json + "\n```"],
    ["a note with braces after the fence", "```json\n" + json + "\n```\nNote: {confidence} is approximate."],
    ["trailing commas", json.replace("}]}", "},]}").replace('plan"}', 'plan",}')],
    ["a bracketed count before the answer", "Results [2 items]:\n" + json],
  ])("reads %s", (_shape, text) => {
    expect(parseModelJson(text)).toEqual(answer);
  });

  it("keeps brackets, commas and quotes inside strings as written", () => {
    const tricky = { results: [{ ...item, reason: 'Said "a, ]" then {b},' }] };
    expect(parseModelJson("Answer:\n" + JSON.stringify(tricky) + "\nDone")).toEqual(tricky);
  });

  it.each([
    ["no JSON at all", "I could not classify these."],
    ["an answer stopped before its first item", '{"results":['],
    ["an answer cut inside an item", '{"results":[{"id":"a","category":"work'],
    ["an answer cut inside a string", '{"results":[{"id":"a","reason":"Editing the'],
  ])("rejects %s with a syntax error", (_shape, text) => {
    expect(() => parseModelJson(text)).toThrow(SyntaxError);
  });
});
