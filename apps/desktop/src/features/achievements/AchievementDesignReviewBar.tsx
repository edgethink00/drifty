import { useState } from "react";
import {
  ACHIEVEMENT_BADGE_VARIANTS,
  ACHIEVEMENT_BADGE_VARIANT_LABELS,
  setAchievementReviewState,
  useAchievementReviewState,
} from "./achievementDesignReview";
import { AchievementUnlockDialog } from "./AchievementUnlockDialog";
import { AchievementMedal } from "./AchievementMedal";
import { achievementName, asEarnedForReview } from "./AchievementsPanel";
import { useLocalization } from "../localization/LocalizationContext";
import type { AchievementItem } from "./useAchievements";

/** Dev-server design review controls (?achievementReview=1); never shown in a build people install. */
export function AchievementDesignReviewBar({ items }: { readonly items: readonly AchievementItem[] }) {
  const { t } = useLocalization();
  const { variant, mockRarity, allEarned } = useAchievementReviewState();
  const [preview, setPreview] = useState<"single" | "firstLook" | null>(null);
  const [board, setBoard] = useState(false);
  const earned = items.filter((item) => item.earned);
  const rarest = [...earned].sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
  return (
    <div className="achievement-review" role="group" aria-label="Badge design review">
      <span className="achievement-review__label">디자인 리뷰 전용</span>
      <div className="achievement-review__variants">
        {ACHIEVEMENT_BADGE_VARIANTS.map((option) => (
          <button
            key={option}
            type="button"
            className={"achievement-review__chip" + (option === variant ? " is-active" : "")}
            aria-pressed={option === variant}
            onClick={() => setAchievementReviewState({ variant: option })}
          >
            {ACHIEVEMENT_BADGE_VARIANT_LABELS[option]}
          </button>
        ))}
      </div>
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
