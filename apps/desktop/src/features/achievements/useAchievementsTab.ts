import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "./achievementCatalog";
import { isAchievementDesignReview, useAchievementReviewState } from "./achievementDesignReview";
import type { AchievementItem, AchievementsSnapshot } from "./useAchievements";

/** The achievement shown first: one just earned, else the latest earned, else the first in the list. */
export function initialAchievementSelection(items: readonly AchievementItem[], unannounced: readonly AchievementId[]): AchievementId {
  if (unannounced.length > 0) return unannounced[0];
  const latest = items.filter((item) => item.earned).sort((left, right) => (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""))[0];
  return (latest ?? items[0]).definition.id;
}

/** Design review only: draw a locked achievement as if it had been earned. */
export function asEarnedForReview(item: AchievementItem): AchievementItem {
  return item.earned ? item : { ...item, earned: { firstDay: "2026-11-01", lastDay: "2026-11-01", count: 1 } };
}

export type AchievementsTabInput = {
  readonly snapshot: AchievementsSnapshot;
  readonly onRetry: () => void;
  readonly onOpenDay: (day: string) => void;
  /** Called once the tab has shown achievements the person had not seen yet. */
  readonly onSeen: (ids: readonly AchievementId[]) => void;
};

/** Everything a layout's tab draws from; the behaviour is the same in every layout. */
export type AchievementsTabModel = {
  readonly status: AchievementsSnapshot["status"];
  /** Every achievement, drawn as earned when the dev review asks for it. */
  readonly items: readonly AchievementItem[];
  readonly byGroup: readonly { readonly group: AchievementGroup; readonly items: readonly AchievementItem[] }[];
  readonly earnedCount: number;
  /** Still loading with nothing earned to show yet. */
  readonly loading: boolean;
  /** Failed with nothing earned to show. */
  readonly failedEmpty: boolean;
  readonly selected: AchievementItem | undefined;
  readonly choose: (id: AchievementId) => void;
  /** Earned and still new when the tab opened; stays true for this visit. */
  readonly isNew: (item: AchievementItem) => boolean;
  readonly onOpenDay: (day: string) => void;
  readonly onRetry: () => void;
};

export function useAchievementsTab({ snapshot, onRetry, onOpenDay, onSeen }: AchievementsTabInput): AchievementsTabModel {
  const { status, unannounced } = snapshot;
  const review = isAchievementDesignReview();
  const { allEarned } = useAchievementReviewState();
  const items = useMemo(
    () => (review && allEarned ? snapshot.items.map(asEarnedForReview) : snapshot.items),
    [allEarned, review, snapshot.items],
  );
  // Remember what was new when the tab opened so it stays marked during this visit.
  const newOnArrival = useRef<Set<AchievementId>>(new Set(unannounced));
  const [selectedId, setSelectedId] = useState<AchievementId>(() => initialAchievementSelection(items, unannounced));
  useEffect(() => {
    if (unannounced.length === 0) return;
    for (const id of unannounced) newOnArrival.current.add(id);
    onSeen(unannounced);
  }, [onSeen, unannounced]);

  const isNew = useCallback((item: AchievementItem) => item.earned !== null && newOnArrival.current.has(item.definition.id), []);
  const byGroup = useMemo(() => ACHIEVEMENT_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.definition.group === group),
  })), [items]);
  const earnedCount = items.filter((item) => item.earned).length;

  return {
    status,
    items,
    byGroup,
    earnedCount,
    loading: status === "loading" && earnedCount === 0,
    failedEmpty: status === "error" && earnedCount === 0,
    selected: items.find((item) => item.definition.id === selectedId) ?? items[0],
    choose: setSelectedId,
    isNew,
    onOpenDay,
    onRetry,
  };
}
