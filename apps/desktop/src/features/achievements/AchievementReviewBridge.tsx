import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import {
  ACHIEVEMENT_LAYOUTS,
  ACHIEVEMENT_LAYOUT_LABELS,
  ACHIEVEMENT_SUMMARY_STYLES,
  ACHIEVEMENT_SUMMARY_STYLE_LABELS,
  isAchievementLayout,
  isAchievementSummaryStyle,
  setAchievementReviewState,
  useAchievementReviewState,
  type AchievementLayoutId,
  type AchievementSummaryStyle,
} from "./achievementDesignReview";
import { achievementBadgeStage, achievementBadgeUrl } from "./achievementBadge";
import { achievementName, asEarnedForReview } from "./AchievementsPanel";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";
import type { AchievementItem } from "./useAchievements";

/** Tag on every message between the app and the review page around it. */
export const ACHIEVEMENT_REVIEW_MESSAGE = "drifty-achievement-review";

/** The same achievement at each medal stage, earned this many times (null: not yet). */
const STAGE_COUNTS: readonly (readonly [string, number | null])[] = [["잠김", null], ["은 · 1번", 1], ["금 · 10번", 10], ["두 줄 금테 · 50번", 50]];

type Preview = "single" | "firstLook";

type Inbound =
  | { readonly action: "hello" }
  | { readonly action: "set"; readonly patch: { readonly allEarned?: unknown; readonly mockRarity?: unknown; readonly layout?: unknown; readonly summary?: unknown } }
  | { readonly action: "preview"; readonly kind: Preview }
  | { readonly action: "openTab" };

function inbound(data: unknown): Inbound | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { source?: unknown; action?: unknown; kind?: unknown; patch?: unknown };
  if (message.source !== ACHIEVEMENT_REVIEW_MESSAGE) return null;
  if (message.action === "hello" || message.action === "openTab") return { action: message.action };
  if (message.action === "preview" && (message.kind === "single" || message.kind === "firstLook")) return { action: "preview", kind: message.kind };
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
export function AchievementReviewBridge({ items, onOpenTab }: { readonly items: readonly AchievementItem[]; readonly onOpenTab: () => void }) {
  const { t } = useLocalization();
  const review = useAchievementReviewState();
  const [preview, setPreview] = useState<Preview | null>(null);
  const earned = useMemo(() => items.filter((item) => item.earned), [items]);
  const rarest = useMemo(() => [...earned].sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0], [earned]);
  const report = useMemo(() => {
    const sample = items.find((item) => item.definition.id === "flow90") ?? items[0];
    return {
      source: ACHIEVEMENT_REVIEW_MESSAGE,
      action: "state",
      state: review,
      earned: earned.length,
      total: items.length,
      canSingle: rarest !== undefined,
      canFirstLook: earned.length >= 2,
      layouts: ACHIEVEMENT_LAYOUTS.map((id) => ({ id, label: ACHIEVEMENT_LAYOUT_LABELS[id] })),
      summaries: ACHIEVEMENT_SUMMARY_STYLES.map((id) => ({ id, label: ACHIEVEMENT_SUMMARY_STYLE_LABELS[id] })),
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
  }, [earned.length, items, rarest, review, t]);
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
      else if (message.action === "preview") setPreview(message.kind);
      else {
        const patch: { allEarned?: boolean; mockRarity?: boolean; layout?: AchievementLayoutId; summary?: AchievementSummaryStyle } = {};
        if (typeof message.patch.allEarned === "boolean") patch.allEarned = message.patch.allEarned;
        if (typeof message.patch.mockRarity === "boolean") patch.mockRarity = message.patch.mockRarity;
        if (isAchievementLayout(message.patch.layout)) patch.layout = message.patch.layout;
        if (isAchievementSummaryStyle(message.patch.summary)) patch.summary = message.patch.summary;
        setAchievementReviewState(patch);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onOpenTab]);

  if (!preview || !rarest) return null;
  return (
    <AchievementUnlockDialog
      items={preview === "single" ? [rarest] : earned}
      firstLook={preview === "firstLook"}
      onClose={() => setPreview(null)}
      onView={() => { setPreview(null); onOpenTab(); }}
    />
  );
}
