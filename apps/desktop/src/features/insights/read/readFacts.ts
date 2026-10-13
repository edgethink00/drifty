import type { DisplayLanguage } from "../../localization/languagePreference";
import { dayLabel, durationLabel, formatValue } from "./readFormat";
import {
  READ_REQUIRED_DAYS,
  RECORDED_DAY_SECONDS,
  dayMetrics,
  localize,
  shiftRows,
  splitRows,
  type InsightsRead,
} from "./readModel";

/**
 * The numbers inside a read's words. The model writes placeholders such as
 * {focus.gap} or {a.days}; the app fills each one from the same day data the
 * evidence is drawn from, and says where it came from. A read whose words
 * name a fact the app cannot compute is not shown as written.
 */

export type ReadFact = { readonly value: string; readonly source: string };

/** Differences smaller than this are "within" the usual on a shift read. */
export const SHIFT_NOTABLE_SECONDS = 30 * 60;

const SLOT_SECONDS = 15 * 60;

function timesCount(count: number, language: DisplayLanguage): string {
  return language === "ko" ? count + "번" : String(count);
}

function dayCount(count: number, language: DisplayLanguage): string {
  if (language === "ko") return count + "일";
  return count + (count === 1 ? " day" : " days");
}

export function readFacts(read: InsightsRead, language: DisplayLanguage): Readonly<Record<string, ReadFact>> {
  const facts: Record<string, ReadFact> = {};
  const ko = language === "ko";
  const evidence = read.evidence;

  if (evidence?.kind === "split") {
    const names = [localize(evidence.groups[0].label, language), localize(evidence.groups[1].label, language)] as const;
    facts["a.days"] = { value: dayCount(evidence.groups[0].dates.length, language), source: names[0] };
    facts["b.days"] = { value: dayCount(evidence.groups[1].dates.length, language), source: names[1] };
    for (const row of splitRows(read)) {
      const label = localize(row.label, language);
      const a = formatValue(row.values[0], row.format, language);
      const b = formatValue(row.values[1], row.format, language);
      const source = label + (ko ? " 하루 평균 · " : ", average day · ") + names[0] + " " + a + " · " + names[1] + " " + b;
      const gap = Math.abs(row.values[0] - row.values[1]);
      facts[row.id + ".a"] = { value: a, source };
      facts[row.id + ".b"] = { value: b, source };
      facts[row.id + ".gap"] = {
        value: row.format === "clock"
          ? durationLabel(gap * SLOT_SECONDS, language)
          : row.format === "percent" ? Math.round(gap * 100) + (ko ? "%p" : " pts") : durationLabel(gap, language),
        source,
      };
    }
    const groupNames = names;
    for (const app of evidence.apps ?? []) {
      const name = app.id === "other" ? (ko ? "기타" : "Other") : app.label;
      const a = durationLabel(app.seconds[0], language);
      const b = durationLabel(app.seconds[1], language);
      const source = name + (ko ? " 하루 평균 · " : ", average day · ") + groupNames[0] + " " + a + " · " + groupNames[1] + " " + b;
      facts["app." + app.id + ".a"] = { value: a, source };
      facts["app." + app.id + ".b"] = { value: b, source };
      facts["app." + app.id + ".gap"] = { value: durationLabel(Math.abs(app.seconds[0] - app.seconds[1]), language), source };
    }
    const switches = switchTotals(read);
    if (switches) {
      const subject = read.subject?.label ?? "";
      const share = (group: 0 | 1) => Math.round((switches.subject[group] / Math.max(1, switches.total[group])) * 100) + "%";
      const subjectSource = (ko ? subject + "와 이어진 하루 이동 · " : "Switches a day with " + subject + " · ") + groupNames[0] + " " + switches.subject[0] + "/" + switches.total[0] + " · " + groupNames[1] + " " + switches.subject[1] + "/" + switches.total[1];
      const workSource = (ko ? "딴짓 앱 없이 오간 하루 이동 · " : "Switches a day between non-drift apps · ") + groupNames[0] + " " + switches.work[0] + " · " + groupNames[1] + " " + switches.work[1];
      facts["switch.subject.a"] = { value: timesCount(switches.subject[0], language), source: subjectSource };
      facts["switch.subject.b"] = { value: timesCount(switches.subject[1], language), source: subjectSource };
      facts["switch.subject.share.a"] = { value: share(0), source: subjectSource };
      facts["switch.subject.share.b"] = { value: share(1), source: subjectSource };
      facts["switch.work.a"] = { value: timesCount(switches.work[0], language), source: workSource };
      facts["switch.work.b"] = { value: timesCount(switches.work[1], language), source: workSource };
    }
    const focusShare = (dates: readonly string[]) => {
      const metrics = read.days.filter((day) => dates.includes(day.date)).map(dayMetrics);
      const tracked = metrics.reduce((sum, m) => sum + m.tracked, 0);
      return tracked === 0 ? 0 : metrics.reduce((sum, m) => sum + m.focus, 0) / tracked;
    };
    const shares = [focusShare(evidence.groups[0].dates), focusShare(evidence.groups[1].dates)] as const;
    const shareSource = (ko ? "기록된 시간 중 집중 · " : "Focus share of tracked time · ") + groupNames[0] + " " + Math.round(shares[0] * 100) + "% · " + groupNames[1] + " " + Math.round(shares[1] * 100) + "%";
    facts["share.focus.a"] = { value: Math.round(shares[0] * 100) + "%", source: shareSource };
    facts["share.focus.b"] = { value: Math.round(shares[1] * 100) + "%", source: shareSource };
  }

  if (evidence?.kind === "shift") {
    const rows = shiftRows(read);
    const usual = ko ? "평소" : "usually";
    const steady = rows.filter((row) => Math.abs(row.delta) < SHIFT_NOTABLE_SECONDS).length;
    facts["steady.days"] = {
      value: dayCount(steady, language),
      source: ko ? "평소와 30분 안쪽으로 차이 난 날" : "Days within 30 minutes of their usual",
    };
    for (const row of rows) {
      const source = dayLabel(row.date, language, "date") + " · " + durationLabel(row.value, language) + ", " + usual + " " + durationLabel(row.usual, language);
      facts[row.date + ".gap"] = { value: durationLabel(Math.abs(row.delta), language), source };
      facts[row.date + ".value"] = { value: durationLabel(row.value, language), source };
    }
  }

  const counted = read.days.filter((entry) => dayMetrics(entry).tracked >= RECORDED_DAY_SECONDS).length;
  facts["counted.days"] = { value: dayCount(counted, language), source: ko ? "2시간 이상 기록된 날" : "Days with 2h or more recorded" };
  facts["required.days"] = { value: dayCount(READ_REQUIRED_DAYS, language), source: ko ? "해석에 필요한 날" : "Days a read needs" };

  return facts;
}

export type FactPart = { readonly text: string } | { readonly fact: ReadFact; readonly id: string };

const PLACEHOLDER = /\{([a-zA-Z0-9.-]+)\}/g;

/** Splits read text into words and filled facts; null when a placeholder names no known fact. */
export function fillFacts(text: string, facts: Readonly<Record<string, ReadFact>>): FactPart[] | null {
  const parts: FactPart[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const fact = facts[match[1]];
    if (!fact) return null;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ fact, id: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Switches a day in each group: all of them, those with the read's subject on one end, and those among non-drift apps. */
export function switchTotals(read: InsightsRead): { readonly total: readonly [number, number]; readonly subject: readonly [number, number]; readonly work: readonly [number, number] } | null {
  const evidence = read.evidence;
  if (evidence?.kind !== "split" || !evidence.switches?.length) return null;
  const switches = evidence.switches;
  const apps = evidence.apps ?? [];
  const subject = apps.find((app) => app.label === read.subject?.label)?.id;
  const kind = new Map(apps.map((app) => [app.id, app.kind]));
  const sum = (group: 0 | 1, keep: (a: string, b: string) => boolean) =>
    switches.filter((edge) => keep(edge.a, edge.b)).reduce((total, edge) => total + edge.perDay[group], 0);
  const all = () => true;
  const touches = (a: string, b: string) => a === subject || b === subject;
  const work = (a: string, b: string) => kind.get(a) !== "drift" && kind.get(b) !== "drift";
  return {
    total: [sum(0, all), sum(1, all)],
    subject: [sum(0, touches), sum(1, touches)],
    work: [sum(0, work), sum(1, work)],
  };
}
