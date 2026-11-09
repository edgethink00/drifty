/**
 * One name for a block that joins several timeline cards (Your Day merges consecutive cards of
 * one activity across naming windows). Only the cards' own titles and recorded minutes go to the
 * model: no records, apps, sites or window titles. The answer must stay within the words the
 * titles already use, so a merged name cannot say more than its cards did.
 *
 * Drifty Cloud builds the same prompt on the server from the cards
 * (supabase/functions/review-activity/mergedBlockTitlePrompt.ts, a byte-identical mirror).
 */

export const MERGED_BLOCK_TITLE_PROMPT_VERSION = "merged-block-title-v1";
export const MERGED_BLOCK_TITLE_MAX_CHARS = 48;
export const MERGED_BLOCK_TITLE_MAX_WORDS = 7;
/** A merged block rarely holds more than ten cards; the largest twelve are sent. */
export const MERGED_BLOCK_TITLE_MAX_CARDS = 12;
const MAX_CARD_TITLE_CHARS = 120;

export type MergedBlockTitleCard = { readonly title: string; readonly minutes: number };
export type MergedBlockTitleLanguage = "ko" | "en";

/** What the request carries: the cards' titles and whole minutes in time order. */
export type MergedBlockTitlePromptInput = {
  readonly promptVersion: string;
  readonly language: MergedBlockTitleLanguage;
  readonly cards: readonly (readonly [title: string, minutes: number])[];
};

/** FNV-1a, so the key stays short whatever the card keys look like. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The same cards in the same language and prompt version always get the same key. */
export function mergedBlockTitleKey(cardKeys: readonly string[], language: string): string {
  return MERGED_BLOCK_TITLE_PROMPT_VERSION + ":" + language + ":" + hash([...new Set(cardKeys)].sort().join("|"));
}

export function mergedBlockTitlePromptInput(cards: readonly MergedBlockTitleCard[], language: MergedBlockTitleLanguage): MergedBlockTitlePromptInput {
  const kept = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => b.card.minutes - a.card.minutes || a.index - b.index)
    .slice(0, MERGED_BLOCK_TITLE_MAX_CARDS)
    .sort((a, b) => a.index - b.index);
  return {
    promptVersion: MERGED_BLOCK_TITLE_PROMPT_VERSION,
    language,
    cards: kept.map(({ card }) => [Array.from(card.title.trim()).slice(0, MAX_CARD_TITLE_CHARS).join(""), Math.max(1, Math.round(card.minutes))] as const),
  };
}

export function buildMergedBlockTitlePromptFromInput(input: MergedBlockTitlePromptInput): string {
  const korean = input.language === "ko";
  return [
    "These activity names, in time order with their minutes, are one continuous stretch of a person's computer use.",
    "Write one short name for the whole stretch, the way a calendar entry would read.",
    "Rules:",
    `- ${korean ? "Write in Korean." : "Write in English."} At most ${MERGED_BLOCK_TITLE_MAX_WORDS} words and ${MERGED_BLOCK_TITLE_MAX_CHARS} characters.`,
    "- Name what most of the minutes were. Leave out activities that took only a few minutes.",
    "- Use only words and things the names below already say. Do not add apps, sites, people, numbers, durations, places or claims of what was achieved.",
    "- No quotes, no ending period, no list of every activity.",
    "",
    ...input.cards.map(([title, minutes], index) => `${index + 1}. ${title} (${minutes} min)`),
    "",
    'Return only JSON: {"title": "..."}',
  ].join("\n");
}

export function buildMergedBlockTitlePrompt(cards: readonly MergedBlockTitleCard[], language: MergedBlockTitleLanguage): string {
  return buildMergedBlockTitlePromptFromInput(mergedBlockTitlePromptInput(cards, language));
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
}

/** Words that say how an app was used, not what was done. */
const USE_WORDS = new Set(["use", "using", "used", "browsing", "app", "apps", "activity", "activities", "and", "with", "on", "in", "the"]);

/** The model's name, or null when it breaks a rule the prompt set. `apps` are the block's apps
 *  and sites: a name made only of them ("ChatGPT use") says what the icon already does. */
export function parseMergedBlockTitle(content: string, cards: readonly MergedBlockTitleCard[], apps: readonly string[] = []): string | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  const raw = typeof parsed === "object" && parsed !== null ? (parsed as { title?: unknown }).title : null;
  if (typeof raw !== "string") return null;
  const title = raw.replace(/[「」『』"“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
  if (!title || Array.from(title).length > MERGED_BLOCK_TITLE_MAX_CHARS || title.split(" ").length > MERGED_BLOCK_TITLE_MAX_WORDS) return null;
  const source = new Set(cards.flatMap((card) => words(card.title)));
  const own = words(title);
  // Grounded: most of its words come from the cards' titles, and numbers only from them.
  const grounded = own.filter((word) => source.has(word) || [...source].some((known) => known.startsWith(word) || word.startsWith(known)));
  if (own.length === 0 || grounded.length / own.length < 0.6) return null;
  if (own.some((word) => /\d/.test(word) && !source.has(word))) return null;
  // A copied card name must hold a real share of the stretch, or it would name a part as the whole.
  const total = cards.reduce((sum, card) => sum + card.minutes, 0);
  const copied = cards.find((card) => card.title.trim().toLowerCase() === title.toLowerCase());
  if (copied && total > 0 && copied.minutes < total * 0.4) return null;
  const appWords = new Set(apps.flatMap((app) => words(app.replace(/\.(com|org|net|io|ai|so|co|kr)$/i, ""))));
  const telling = own.filter((word) => !USE_WORDS.has(word));
  if (telling.length === 0 || telling.every((word) => appWords.has(word))) return null;
  return title;
}
