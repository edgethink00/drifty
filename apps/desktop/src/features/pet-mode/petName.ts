import { useCallback, useSyncExternalStore } from "react";
import type { DisplayLanguage } from "../localization/languagePreference";

/**
 * The desktop cat's name, kept on this computer only like its coat and size. It is never sent
 * to Drifty's servers, AI providers or analytics; an empty value means the cat has no name and is
 * called "the cat".
 */
export const PET_NAME_STORAGE_KEY = "drifty.pet.name.v1";
export const PET_NAME_MAX_GRAPHEMES = 12;
const PET_NAME_CHANGE_EVENT = "drifty:pet-name-change";

type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };

/** Visible characters, so an emoji or a combined letter counts once (the same approach as the profile name). */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locales?: string | string[], options?: { granularity: "grapheme" }) => GraphemeSegmenter;
  }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  return Array.from(text);
}

/** Keeps at most twelve visible characters while the user is still typing (spaces stay). */
export function clipPetName(text: string): string {
  return graphemes(text.replace(/[\r\n]+/gu, " ")).slice(0, PET_NAME_MAX_GRAPHEMES).join("");
}

/** The name as it is saved and shown: inner spaces collapsed, ends trimmed, twelve characters at most. */
export function normalizePetName(text: string): string {
  return clipPetName(text.replace(/\s+/gu, " ").trim()).trim();
}

export function readPetName(): string {
  try {
    return normalizePetName(window.localStorage.getItem(PET_NAME_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

/** Saves the name (an empty name removes it) and tells every open surface in this window. */
export function writePetName(name: string): void {
  const next = normalizePetName(name);
  try {
    if (next) window.localStorage.setItem(PET_NAME_STORAGE_KEY, next);
    else window.localStorage.removeItem(PET_NAME_STORAGE_KEY);
  } catch {
    /* Storage unavailable: nothing to keep. */
  }
  window.dispatchEvent(new Event(PET_NAME_CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === PET_NAME_STORAGE_KEY) onChange(); };
  window.addEventListener(PET_NAME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PET_NAME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The saved name, kept in step across the intro, Settings and other windows. */
export function usePetName(): readonly [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, readPetName, () => "");
  return [name, useCallback((next: string) => writePetName(next), [])];
}

/**
 * Whether a Korean particle after the name takes the final-consonant form (이/을/은).
 * Hangul reads its final consonant, digits their Korean reading, Latin letters their usual
 * Korean ending sound; anything else is read as ending in a vowel.
 */
export function endsWithFinalConsonant(word: string): boolean {
  const parts = graphemes(word);
  const last = parts[parts.length - 1] ?? "";
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/u.test(last)) return "013678".includes(last);
  if (/[a-z]/iu.test(last)) return /(?:ng|[lmnkptb])$/iu.test(word);
  return false;
}

/** The name as the subject of a sentence: Korean adds 이/가, other languages use the name as is. */
export function petNameAsSubject(name: string, language: DisplayLanguage): string {
  if (language !== "ko") return name;
  return name + (endsWithFinalConsonant(name) ? "이" : "가");
}
