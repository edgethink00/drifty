import { useState } from "react";
import { setAchievementReviewState, useAchievementReviewState } from "./achievementDesignReview";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";
import { AchievementMedal } from "./AchievementMedal";
import { achievementName, asEarnedForReview } from "./AchievementsPanel";
import { useLocalization } from "../localization/LocalizationContext";
import type { AchievementItem } from "./useAchievements";

/** The same achievement at each medal stage, earned this many times (null: not yet). */
const STAGE_COUNTS: readonly (readonly [string, number | null])[] = [["잠김", null], ["은 · 1번", 1], ["금 · 10번", 10], ["두 줄 금테 · 50번", 50]];

/** Dev-server design review controls (?achievementReview=1); never shown in a build people install. */
export function AchievementDesignReviewBar({ items }: { readonly items: readonly AchievementItem[] }) {
  const { t } = useLocalization();
  const { mockRarity, allEarned } = useAchievementReviewState();
  const [preview, setPreview] = useState<"single" | "firstLook" | null>(null);
  const [board, setBoard] = useState(false);
  const earned = items.filter((item) => item.earned);
  const rarest = [...earned].sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
  const sample = items.find((item) => item.definition.id === "flow90") ?? items[0];
  return (
    <div className="achievement-review" role="group" aria-label="Achievement design review">
      <span className="achievement-review__label">디자인 리뷰 전용</span>
      <label className="achievement-review__toggle">
        <input type="checkbox" checked={allEarned} onChange={(event) => setAchievementReviewState({ allEarned: event.target.checked })} />
        모두 얻은 상태로 보기
      </label>
      <label className="achievement-review__toggle">
        <input type="checkbox" checked={mockRarity} onChange={(event) => setAchievementReviewState({ mockRarity: event.target.checked })} />
        희귀도 예시 수치
      </label>
      <button type="button" className="achievement-review__chip" disabled={!rarest} onClick={() => setPreview("single")}>새 업적 카드</button>
      <button type="button" className="achievement-review__chip" disabled={earned.length < 2} onClick={() => setPreview("firstLook")}>첫 회고 카드</button>
      <button type="button" className={"achievement-review__chip" + (board ? " is-active" : "")} aria-pressed={board} onClick={() => setBoard((value) => !value)}>배지 크게 보기</button>
      {board ? (
        <div className="achievement-review__board">
          {items.map(asEarnedForReview).map((item) => (
            <div key={item.definition.id} className="achievement-review__board-item">
              <AchievementMedal item={item} size="xl" />
              <span>{achievementName(item, t)}</span>
            </div>
          ))}
          {sample ? STAGE_COUNTS.map(([label, count]) => (
            <div key={label} className="achievement-review__board-item achievement-review__board-item--stage">
              <AchievementMedal item={{ ...sample, earned: count === null ? null : { firstDay: "2026-11-01", lastDay: "2026-11-01", count } }} size="xl" />
              <span>{label}</span>
            </div>
          )) : null}
        </div>
      ) : null}
      {preview && rarest ? (
        <AchievementUnlockDialog
          items={preview === "single" ? [rarest] : earned}
          firstLook={preview === "firstLook"}
          onClose={() => setPreview(null)}
          onView={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
