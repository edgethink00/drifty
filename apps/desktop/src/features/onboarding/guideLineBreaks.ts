import { Fragment, createElement, type ReactNode } from "react";
import type { DisplayLanguage } from "../localization/languagePreference";

const NBSP = "\u00a0";
const KO_DETERMINERS = new Set(["여러", "모든", "이런", "그런", "어떤", "다른"]);
/** Multi-word app places named in the copy; a line never splits them. */
const UI_TERMS = [/메뉴 막대/g, /시스템 트레이/g, /계정 메뉴/g, /menu bar/g, /system tray/g, /account menu/g];
/** True for a two-syllable Korean adnominal such as 작은, 지난, 고친 (last syllable ends in ㄴ). */
function isShortAdnominal(word: string): boolean {
  if (KO_DETERMINERS.has(word)) return true;
  if (!/^[가-힣]{2}$/.test(word)) return false;
  return (word.charCodeAt(1) - 0xac00) % 28 === 4;
}

/**
 * Swaps selected spaces in intro-card copy for no-break spaces so lines only break between
 * meaningful units. CSS keep-all and text-wrap cannot see these units:
 * - quoted app labels and named app places stay whole: ‘이번 주’, 메뉴 막대, menu bar;
 * - Korean dependent nouns bind to both neighbours: "열 수 있어요", and one-syllable
 *   modifiers, two-syllable adnominals ending in ㄴ and determiners bind to the next word:
 *   "쓴 시간이", "한 번", "작은 링으로", "여러 날을";
 * - English multi-word UI names stay whole: "Your Week", "Show pet";
 * - a short word that opens a sentence binds to the next word, so a new sentence never
 *   starts with one stranded word at the end of a line ("… 보여줘요. 눌러서 / 기록을");
 * - the last two words of each line of copy stay together, so no line ends with a lone word even
 *   where text-wrap: pretty is unsupported (older WebKit).
 */
export function keepGuidePhrasesTogether(text: string, language: DisplayLanguage): string {
  let out = text.replace(/‘[^’\n]*’/g, label => label.replace(/ /g, NBSP));
  for (const term of UI_TERMS) out = out.replace(term, match => match.replace(/ /g, NBSP));
  if (language === "ko") {
    out = out.replace(/ (수|것|때|줄|적|뿐) /g, NBSP + "$1" + NBSP);
    out = out.replace(/(^|[ \u00a0\n])([가-힣]) (?=[가-힣‘])/g, "$1$2" + NBSP);
    out = out.replace(/(^|[ \u00a0\n])([가-힣]{2}) (?=[가-힣‘])/g, (match, lead: string, word: string) => isShortAdnominal(word) ? lead + word + NBSP : match);
  } else {
    out = out.replace(/\b(Your|Show) (?=[A-Za-z])/g, "$1" + NBSP);
  }
  const opener = language === "ko" ? 4 : 6;
  out = out.replace(/([.!?] )([^ \u00a0\n]+) (?=\S)/g, (match, stop: string, word: string) => word.length <= opener ? stop + word + NBSP : match);
  // Only a short last word is lifted onto the previous one. A tail that is already a kept phrase
  // ("비교할 수 있어요.") must stay breakable from the word before it, or the kept unit grows into a
  // whole clause and forces a stranded short line above it.
  const lone = language === "ko" ? 5 : 12;
  return out.split("\n").map(line => {
    const last = line.lastIndexOf(" ");
    const tail = line.slice(last + 1);
    return last > 0 && !tail.includes(NBSP) && tail.length <= lone && line.indexOf(" ") !== last ? line.slice(0, last) + NBSP + tail : line;
  }).join("\n");
}

/**
 * Renders copy with each kept unit in a nowrap span. The text itself keeps ordinary spaces, so the
 * dialog's accessible name and screen-reader output match the translation exactly.
 */
export function GuidePhrases({ text, language }: { readonly text: string; readonly language: DisplayLanguage }): ReactNode {
  const parts = keepGuidePhrasesTogether(text, language).split(/([ \n])/);
  return createElement(Fragment, null, ...parts.map((part, index) => part.includes(NBSP)
    ? createElement("span", { key: index, className: "guide-keep" }, part.split(NBSP).join(" "))
    : part));
}
