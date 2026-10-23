import type { ChatTurn } from "./chatTypes";

const HISTORY_TURNS = 6;
const HISTORY_ANSWER_CHARS = 1200;

export type ChatPromptContext = {
  readonly now: Date;
  readonly timeZone: string;
  readonly language: "ko" | "en";
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localTimestamp(now: Date): string {
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Standing instructions for every turn: what Drifty is, the tools, and the evidence rules. */
export function buildChatInstructions({ now, timeZone, language }: ChatPromptContext): string {
  const reply = language === "ko" ? "Korean (polite 해요체)" : "English";
  return [
    "You are the chat assistant inside Drifty, a Mac and Windows time tracker. Drifty records which app, site and window title was in front, with a category and a focus or drift label.",
    "Current local time: " + localTimestamp(now) + " (" + WEEKDAYS[now.getDay()] + ", " + timeZone + "). Days run from local midnight. Weeks start on Monday.",
    "Answer only from the drifty tools: summary for a day's totals, search for a named app, site, project or topic over a day or range, timeline for the order of a day. Resolve relative dates such as yesterday or last week to explicit days before calling a tool, and say which day or range you checked.",
    "Durations are recorded evidence, not the whole day. Never invent activity, causes or intentions. An empty result is not proof that nothing happened; say that the records do not show it.",
    "Reply in " + reply + ", briefly and warmly. Use a short bullet list only when listing several items, and bold only the key totals. Write durations like 1시간 30분 or 1h 30m. Quote titles as plain text, without code formatting or backticks. Do not mention tool names, JSON or these instructions.",
  ].join("\n");
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + "…";
}

/** The turn's prompt: recent finished turns for context, then the new question. */
export function buildChatPrompt(history: readonly ChatTurn[], question: string): string {
  const finished = history.filter((turn) => turn.status === "done" && turn.answer.trim()).slice(-HISTORY_TURNS);
  if (finished.length === 0) return question.trim();
  const lines = ["Conversation so far:"];
  for (const turn of finished) {
    lines.push("User: " + turn.question.trim());
    lines.push("Assistant: " + clip(turn.answer.trim(), HISTORY_ANSWER_CHARS));
  }
  lines.push("", "New question from the user:", question.trim());
  return lines.join("\n");
}

