import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { AchievementId } from "./achievementCatalog";
import { achievementAnnouncement, type AchievementAnnouncement } from "./achievementAnnouncement";
import {
  ACHIEVEMENT_REVIEW_ARRIVALS,
  ACHIEVEMENT_REVIEW_HOLDINGS,
  ACHIEVEMENT_REVIEW_HOLDING_LABELS,
  isAchievementReviewHolding,
  setAchievementReviewState,
  useAchievementReviewState,
  type AchievementReviewHolding,
} from "./achievementDesignReview";
import { achievementBadgeStage, achievementBadgeUrl } from "./achievementBadge";
import { achievementName, asEarnedForReview } from "./AchievementsPanel";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";
import type { AchievementItem } from "./useAchievements";
import { itemsForReviewHolding } from "./useAchievementsTab";

/** Tag on every message between the app and the review page around it. */
export const ACHIEVEMENT_REVIEW_MESSAGE = "drifty-achievement-review";

/** The same achievement at each medal stage, earned this many times (null: not yet). */
const STAGE_COUNTS: readonly (readonly [string, number | null])[] = [["잠김", null], ["은 · 1번", 1], ["로즈골드 · 10번", 10], ["두 줄 테 · 50번", 50]];

/** single: one new achievement; several: three found on the same day; firstLook: everything the first check found. */
type Preview = "single" | "several" | "firstLook";

type Inbound =
  | { readonly action: "hello" }
  | { readonly action: "set"; readonly patch: { readonly allEarned?: unknown; readonly holding?: unknown; readonly mockRarity?: unknown; } }
  | { readonly action: "preview"; readonly kind: Preview }
  | { readonly action: "openTab" }
  | { readonly action: "replay" };

function inbound(data: unknown): Inbound | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { source?: unknown; action?: unknown; kind?: unknown; patch?: unknown };
  if (message.source !== ACHIEVEMENT_REVIEW_MESSAGE) return null;
  if (message.action === "hello" || message.action === "openTab" || message.action === "replay") return { action: message.action };
  if (message.action === "preview" && (message.kind === "single" || message.kind === "several" || message.kind === "firstLook")) return { action: "preview", kind: message.kind };
  if (message.action === "set" && typeof message.patch === "object" && message.patch !== null) return { action: "set", patch: message.patch as Record<string, unknown> };
  return null;
}

function absolute(url: string | undefined): string | null {
  return url ? new URL(url, window.location.href).href : null;
}

/**
 * Dev-server design review only (?achievementReview=1). The review controls
 * live on the review page around the app, outside its window, so they never
 * change the layout being judged; this listens for them, opens the card
 * previews they ask for and reports the medals back.
 */
type BridgeProps = {
  readonly items: readonly AchievementItem[];
  /** New achievements not shown yet, as the app sees them. */
  readonly unannounced: readonly AchievementId[];
  readonly onOpenTab: () => void;
  readonly onOpenDashboard: () => void;
  readonly onSeen: (ids: readonly AchievementId[]) => void;
};

/** What the card would show for these arrivals: the earlier rule cards them all, the current one asks achievementAnnouncement. */
function arrivalCard(items: readonly AchievementItem[], waiting: readonly AchievementId[], rule: "before" | "after"): AchievementAnnouncement | null {
  if (rule === "after") return achievementAnnouncement(items, waiting, false);
  const ids = items.filter((item) => item.earned && waiting.includes(item.definition.id)).map((item) => item.definition.id);
  return ids.length > 0 ? { ids, firstLook: false } : null;
}

export function AchievementReviewBridge({ items: recorded, unannounced, onOpenTab, onOpenDashboard, onSeen }: BridgeProps) {
  const { t } = useLocalization();
  const review = useAchievementReviewState();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [arrival, setArrival] = useState<AchievementAnnouncement | null>(null);
  const [arrivalDecided, setArrivalDecided] = useState<{ readonly card: readonly AchievementId[] | null } | null>(null);
  // The cards preview what the chosen holding has earned, as the tab shows it.
  const items = useMemo(() => itemsForReviewHolding(recorded, review.holding), [recorded, review.holding]);
  const earned = useMemo(() => items.filter((item) => item.earned), [items]);
  const rarest = useMemo(() => [...earned].sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0], [earned]);
  // An arrival scenario greets the person on the dashboard the way the app would, under the chosen rule.
  const [arrivalRound, setArrivalRound] = useState(0);
  useEffect(() => {
    if (!review.arrival) return;
    onOpenDashboard();
    const timer = window.setTimeout(() => {
      const card = arrivalCard(items, ACHIEVEMENT_REVIEW_ARRIVALS[review.arrival!].ids, review.rule);
      setArrival(card);
      setArrivalDecided({ card: card?.ids ?? null });
    }, 900);
    return () => window.clearTimeout(timer);
    // Decided once per round; later item changes come from closing the card itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalRound, review.arrival]);
  const report = useMemo(() => {
    const sample = items.find((item) => item.definition.id === "flow90") ?? items[0];
    return {
      source: ACHIEVEMENT_REVIEW_MESSAGE,
      action: "state",
      state: review,
      arrival: review.arrival ? {
        scenario: review.arrival,
        rule: review.rule,
        arrived: ACHIEVEMENT_REVIEW_ARRIVALS[review.arrival].ids.map((id) => {
          const item = items.find((entry) => entry.definition.id === id);
          return { id, name: item ? achievementName(item, t) : id, percent: item?.rarity?.percent ?? null };
        }),
        card: arrivalDecided ? (arrivalDecided.card ?? []).map((id) => {
          const item = items.find((entry) => entry.definition.id === id);
          return item ? achievementName(item, t) : id;
        }) : null,
        waiting: unannounced.length,
      } : null,
      earned: earned.length,
      total: items.length,
      canSingle: rarest !== undefined,
      canSeveral: earned.length >= 2,
      canFirstLook: earned.length >= 2,
      holdings: ACHIEVEMENT_REVIEW_HOLDINGS.map((id) => ({ id, label: ACHIEVEMENT_REVIEW_HOLDING_LABELS[id] })),
      medals: items.map(asEarnedForReview).map((item) => ({
        id: item.definition.id,
        name: achievementName(item, t),
        url: absolute(achievementBadgeUrl(item.definition.id, achievementBadgeStage(item))),
      })),
      stages: sample ? STAGE_COUNTS.map(([label, count]) => {
        const staged: AchievementItem = { ...sample, earned: count === null ? null : { firstDay: "2026-11-01", lastDay: "2026-11-01", count } };
        return { label, url: absolute(achievementBadgeUrl(sample.definition.id, achievementBadgeStage(staged))) };
      }) : [],
    };
  }, [arrivalDecided, earned.length, items, rarest, review, t, unannounced.length]);
  const latest = useRef(report);

  useEffect(() => {
    latest.current = report;
    window.parent.postMessage(report, "*");
  }, [report]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const message = inbound(event.data);
      if (!message) return;
      if (message.action === "hello") window.parent.postMessage(latest.current, "*");
      else if (message.action === "openTab") { setPreview(null); onOpenTab(); }
      else if (message.action === "replay") {
        setPreview(null);
        setArrival(null);
        setArrivalDecided(null);
        setAchievementReviewState({ seen: [] });
        setArrivalRound((round) => round + 1);
      }
      else if (message.action === "preview") setPreview(message.kind);
      else {
        const patch: { holding?: AchievementReviewHolding; mockRarity?: boolean; } = {};
        // An older review page sends "all earned" as a switch.
        if (typeof message.patch.allEarned === "boolean") patch.holding = message.patch.allEarned ? "all" : "record";
        if (isAchievementReviewHolding(message.patch.holding)) patch.holding = message.patch.holding;
        if (typeof message.patch.mockRarity === "boolean") patch.mockRarity = message.patch.mockRarity;
        setAchievementReviewState(patch);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onOpenTab]);

  if (arrival) {
    const shown = items.filter((item) => item.earned && arrival.ids.includes(item.definition.id));
    return (
      <AchievementUnlockDialog
        items={shown}
        firstLook={arrival.firstLook}
        onClose={() => { onSeen(arrival.ids); setArrival(null); }}
        onView={() => { setArrival(null); onOpenTab(); }}
      />
    );
  }
  if (!preview || !rarest) return null;
  return (
    <AchievementUnlockDialog
      items={preview === "single" ? [rarest] : preview === "several" ? [rarest, ...earned.filter((item) => item !== rarest).slice(0, 2)] : earned}
      firstLook={preview === "firstLook"}
      onClose={() => setPreview(null)}
      onView={() => { setPreview(null); onOpenTab(); }}
    />
  );
}
