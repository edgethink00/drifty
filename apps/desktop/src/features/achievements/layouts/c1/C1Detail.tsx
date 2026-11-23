import type { TranslationKey } from "../../../localization/translations";
import { useLocalization } from "../../../localization/LocalizationContext";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  rarityReadsAsFew,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis, formatRarityPercent } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { C1Medal } from "./C1Medal";
import { tileStatus } from "./c1Copy";

const MEDAL_STEPS: readonly { readonly stage: AchievementBadgeStage; readonly from: number }[] = [
  { stage: "silver", from: 1 },
  { stage: "gold", from: GOLD_FROM_COUNT },
  { stage: "ring", from: RING_FROM_COUNT },
];

type DetailProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly onOpenDay: (day: string) => void;
  /** The rest of the chosen one's group, in board order. */
  readonly siblings: readonly AchievementItem[];
  readonly onChoose: (id: AchievementItem["definition"]["id"]) => void;
};

/** The closest one still open in the same group: one place to go next, or a quiet line when the group is full. */
function NextInGroup({ item, siblings, group, onChoose }: { readonly item: AchievementItem; readonly siblings: readonly AchievementItem[]; readonly group: string; readonly onChoose: DetailProps["onChoose"] }) {
  const { effectiveLanguage, t } = useLocalization();
  const next = siblings
    .filter((sibling) => !sibling.earned)
    .sort((left, right) => Number(left.definition.hidden) - Number(right.definition.hidden) || progressShare(right) - progressShare(left))[0];
  if (!next) {
    return item.earned ? <p className="c1-next c1-next__done">{t("achievements.c1.groupDone")}</p> : null;
  }
  const line = tileStatus(next, t, effectiveLanguage);
  const title = t("achievements.c1.nextInGroup", { group });
  return (
    <section className="c1-next" aria-label={title}>
      <p className="c1-next__title" aria-hidden="true">{title}</p>
      <button type="button" className="c1-next__item" onClick={() => onChoose(next.definition.id)}>
        <C1Medal item={next} small className="c1-medal c1-next__medal" />
        <span className="c1-next__text">
          <span className="c1-next__name">{achievementName(next, t)}</span>
          <span className="c1-next__status" data-kind={line.kind}>{line.kind === "earned" ? line.day : line.text}</span>
          {line.kind === "progress" ? (
            <span className="c1-bar c1-next__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(next) * 100) + "%" }} /></span>
          ) : null}
        </span>
      </button>
    </section>
  );
}

/** The chosen achievement beside the board: medal, name, then label-value rows. */
export function C1Detail({ item, isNew, onOpenDay, siblings, onChoose }: DetailProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const stage = achievementBadgeStage(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const day = earned ? achievementDay(item) ?? earned.firstDay : null;
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));

  return (
    <aside className="editorial-panel c1-detail" data-state={earned ? "earned" : "locked"} aria-live="polite">
      <div key={definition.id} className="c1-detail__inner">
        <C1Medal item={item} className="c1-medal c1-detail__medal" />
        <p className="c1-detail__context">
          {context.join(" · ")}
          {isNew ? <span className="c1-detail__new"><span className="c1-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
        </p>
        <h3 className="c1-detail__name">{achievementName(item, t)}</h3>
        <p className="c1-detail__condition">{achievementCondition(item, t)}</p>

        {!concealed ? (
          <dl className="c1-facts">
            {rarity ? (
              <div className="c1-facts__row c1-facts__row--stat">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd>
                  <span className="c1-stat__value">{t("achievements.c1.percent", { value: formatRarityPercent(rarity.percent, effectiveLanguage) })}</span>
                  <span className="c1-stat__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</span>
                </dd>
                <dd className="c1-facts__span">
                  {rarityReadsAsFew(rarity)
                    ? raritySentence(rarity, t, effectiveLanguage, "tab")
                    : t("achievements.c1.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
                </dd>
              </div>
            ) : null}
            {earned ? (
              <div className="c1-facts__row">
                <dt>{t("achievements.record.title")}</dt>
                <dd>
                  {definition.repeatable && earned.count > 1 ? (
                    <>
                      <span className="c1-facts__value">{timesLabel(earned.count, t)}</span>
                      <span className="c1-facts__note">
                        {t("achievements.c1.span", {
                          first: formatAchievementDay(earned.firstDay, effectiveLanguage),
                          last: formatAchievementDay(earned.lastDay, effectiveLanguage),
                        })}
                      </span>
                    </>
                  ) : (
                    <span className="c1-facts__value">{t("achievements.dialog.earnedOn", { date: formatAchievementDay(day ?? earned.firstDay, effectiveLanguage) })}</span>
                  )}
                  {day ? (
                    <button type="button" className="c1-link c1-facts__day" onClick={() => onOpenDay(day)}>
                      {t("achievements.openDay")}
                    </button>
                  ) : null}
                </dd>
              </div>
            ) : progress ? (
              <div className="c1-facts__row">
                <dt>{t("achievements.progress")}</dt>
                <dd>
                  <span className="c1-facts__value">{progress}</span>
                  <span className="c1-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
                  <span className="c1-facts__note">{remainingText(item, t, effectiveLanguage)}</span>
                </dd>
              </div>
            ) : (
              <div className="c1-facts__row">
                <dt>{t("achievements.record.title")}</dt>
                <dd><span className="c1-facts__value is-quiet">{t("achievements.notEarned")}</span></dd>
              </div>
            )}

            {earned ? (
              <div className="c1-facts__row">
                <dt>{t("achievements.medal.title")}</dt>
                <dd>
                  <span className="c1-track" aria-hidden="true">
                    {(definition.repeatable ? MEDAL_STEPS : MEDAL_STEPS.filter((step) => step.stage === stage)).map((step) => {
                      const src = achievementBadgeUrl(definition.id, step.stage, true);
                      return (
                        <span key={step.stage} className="c1-track__stop" data-current={step.stage === stage ? "true" : undefined}>
                          {src ? <img src={src} alt="" draggable={false} /> : null}
                        </span>
                      );
                    })}
                  </span>
                  <span className="c1-facts__value">{medalName(item, t)}</span>
                  <span className="c1-facts__note">
                    {!definition.repeatable ? t("achievements.medal.once") : medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")}
                  </span>
                </dd>
              </div>
            ) : null}

          </dl>
        ) : null}

        <NextInGroup item={item} siblings={siblings} group={context[0] ?? ""} onChoose={onChoose} />
      </div>
    </aside>
  );
}
