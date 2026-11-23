import type { TranslationKey } from "../../../localization/translations";
import { useLocalization } from "../../../localization/LocalizationContext";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityReadsAsFew,
  raritySentence,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis } from "../../achievementRarity";
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

function Siblings({ items, group, onChoose }: { readonly items: readonly AchievementItem[]; readonly group: string; readonly onChoose: DetailProps["onChoose"] }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <section className="c1-sibs" aria-label={t("achievements.c1.inGroup", { group })}>
      <p className="c1-sibs__title" aria-hidden="true">{t("achievements.c1.inGroup", { group })}</p>
      {items.map((item) => {
        const name = achievementName(item, t);
        const line = tileStatus(item, t, effectiveLanguage);
        return (
          <button
            key={item.definition.id}
            type="button"
            className="c1-sib"
            data-state={item.earned ? "earned" : "locked"}
            onClick={() => onChoose(item.definition.id)}
          >
            <C1Medal item={item} small className="c1-medal c1-sib__medal" />
            <span className="c1-sib__name">{name}</span>
            <span className="c1-sib__status" data-kind={line.kind}>
              {line.kind === "earned" ? [line.day, line.times].filter(Boolean).join(" · ") : line.text}
            </span>
          </button>
        );
      })}
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

            {rarity ? (
              <div className="c1-facts__row">
                <dt>{t("achievements.rarity.title")}</dt>
                <dd>
                  <span className="c1-facts__value">{raritySentence(rarity, t, effectiveLanguage, "tab")}</span>
                  <span className="c1-facts__note is-faint">
                    {rarityReadsAsFew(rarity)
                      ? t("achievements.rarity.basisShort")
                      : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {day ? (
          <button type="button" className="app-btn app-btn--secondary app-btn--compact c1-detail__day" onClick={() => onOpenDay(day)}>
            {t("achievements.openDay")}
          </button>
        ) : null}

        {siblings.length > 0 ? <Siblings items={siblings} group={context[0] ?? ""} onChoose={onChoose} /> : null}
      </div>
    </aside>
  );
}
