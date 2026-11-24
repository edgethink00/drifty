import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { historyEntries, historyFor } from "../../achievementHistory";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import { C14Medal } from "./C14Medal";
import { C14Ribbon } from "./C14Ribbon";
import { earlierText, ordinal, shortDay } from "./c14Copy";

const RIBBON_MAX = 8;

type RowProps = {
  readonly item: AchievementItem;
  readonly idBase: string;
  readonly open: boolean;
  readonly isNew: boolean;
  readonly almostThere?: boolean;
  readonly onToggle: () => void;
  readonly onOpenDay: (day: string) => void;
};

function isGold(item: AchievementItem): boolean {
  const stage = achievementBadgeStage(item);
  return stage === "gold" || stage === "ring";
}

/** The right half of a row: the ribbon of days, the earned date, the progress track, or nothing. */
function RowRecord({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const history = historyFor(item);
  if (earned && history && definition.repeatable) {
    const total = history.days.length + history.earlier;
    return (
      <div className="c14-record" data-kind="ribbon">
        <C14Ribbon days={history.days} total={total} max={RIBBON_MAX} gold={isGold(item)} onOpenDay={onOpenDay} className="c14-record__ribbon" />
        <span className="c14-record__count">{timesLabel(total, t)}</span>
      </div>
    );
  }
  if (earned) {
    return (
      <div className="c14-record" data-kind="date">
        <span className="c14-once" data-metal={isGold(item) ? "gold" : "silver"}>
          <button type="button" className="c14-tick__hit" tabIndex={-1} aria-hidden="true" onClick={() => onOpenDay(earned.firstDay)}>
            <span className="c14-tick__date">{formatAchievementDay(earned.firstDay, effectiveLanguage)}</span>
            <span className="c14-tick__mark" />
          </button>
        </span>
      </div>
    );
  }
  const progress = definition.hidden ? null : progressText(item, t, effectiveLanguage);
  if (!progress) return <div className="c14-record" data-kind="none" />;
  return (
    <div className="c14-record" data-kind="progress">
      <span className="c14-track__text">{progress}</span>
      <span className="c14-record__count c14-track__left">{remainingText(item, t, effectiveLanguage)}</span>
      <span className="c14-track" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
    </div>
  );
}

function OpenedFacts({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const concealed = definition.hidden && !earned;
  const rarity = shownRarity(item);
  const medal = nextMedal(item);
  const progress = earned || concealed ? null : progressText(item, t, effectiveLanguage);
  const facts: { key: string; term: string; value: string; note?: string | null; notable?: boolean }[] = [];
  if (earned) {
    facts.push({
      key: "medal",
      term: t("achievements.medal.title"),
      value: medalName(item, t) ?? "",
      note: definition.repeatable ? (medal ? t(medal.key, { remaining: medal.remaining }) : t("achievements.medal.top")) : t("achievements.medal.once"),
    });
  } else if (!concealed) {
    facts.push({
      key: "progress",
      term: t("achievements.progress"),
      value: progress ?? t("achievements.notEarned"),
      note: progress ? remainingText(item, t, effectiveLanguage) : null,
    });
  }
  if (rarity) {
    facts.push({
      key: "rarity",
      term: t("achievements.rarity.title"),
      value: rarityTierName(item, rarity, t),
      note: raritySentence(rarity, t, effectiveLanguage, "tab"),
      notable: rarityIsNotable(item, rarity),
    });
  }
  if (earned && definition.repeatable) {
    facts.push({ key: "first", term: t("achievements.c14.firstDay"), value: formatAchievementDay(earned.firstDay, effectiveLanguage) });
  }
  if (facts.length === 0) return <p className="c14-open__quiet">{t("achievements.notEarned")}</p>;
  return (
    <dl className="c14-facts">
      {facts.map(({ key, term, value, note, notable }) => (
        <div key={key} className="c14-facts__row">
          <dt>{term}</dt>
          <dd>
            <span className="c14-facts__value" data-notable={notable ? "true" : undefined}>{value}</span>
            {note ? <span className="c14-facts__note">{note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OpenedDays({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const history = historyFor(item);
  if (!item.earned || !history) return null;
  const repeatable = item.definition.repeatable;
  return (
    <div className="c14-days">
      <p className="c14-days__title">{repeatable ? t("achievements.record.title") : t("achievements.stat.earnedOn")}</p>
      <ol className="c14-days__list" data-metal={isGold(item) ? "gold" : "silver"}>
        {historyEntries(history).map(({ day, ordinal: count }, index) => {
          const nth = ordinal(count, t, effectiveLanguage);
          return (
            <li key={day}>
              <button
                type="button"
                className="c14-day"
                data-history-day={day}
                data-newest={index === 0 ? "true" : undefined}
                aria-label={t("achievements.c14.historyDay", { nth, date: formatAchievementDay(day, effectiveLanguage) })}
                onClick={() => onOpenDay(day)}
              >
                {repeatable ? <span className="c14-day__nth">{count}</span> : null}
                <span className="c14-day__date">{repeatable ? shortDay(day, effectiveLanguage) : formatAchievementDay(day, effectiveLanguage)}</span>
              </button>
            </li>
          );
        })}
        {history.earlier > 0 ? (
          <li className="c14-days__earlier" data-history-earlier={history.earlier}>{earlierText(history.earlier, t)}</li>
        ) : null}
      </ol>
    </div>
  );
}

/**
 * One achievement as one row. A stretched disclosure button covers the row;
 * the name is the row's own level-3 heading, so when the row opens the whole
 * item becomes the region it names and the rest unfolds beneath.
 */
export function C14Row({ item, idBase, open, isNew, almostThere = false, onToggle, onOpenDay }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const name = achievementName(item, t);
  const nameId = idBase + "-name";
  const openId = idBase + "-open";
  const rarity = shownRarity(item);
  const meta = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) meta.push(t("achievements.hiddenFound"));
  return (
    <section
      className="c14-item"
      data-state={earned ? "earned" : definition.hidden ? "hidden" : "locked"}
      data-open={open ? "true" : undefined}
      data-almost={almostThere ? "true" : undefined}
      aria-labelledby={open ? nameId : undefined}
      lang={effectiveLanguage}
    >
      <div className="c14-row">
        <button
          type="button"
          className="c14-row__hit"
          aria-expanded={open}
          aria-controls={open ? openId : undefined}
          aria-label={t(earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
          onClick={onToggle}
        />
        <C14Medal item={item} className="c14-medal c14-row__medal" />
        <div className="c14-row__text">
          <div className="c14-row__title">
            <h3 id={nameId} className="c14-row__name">{name}</h3>
            <span className="c14-row__meta">
              {meta.join(" · ")}
              {rarity ? <span className="c14-row__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{" · " + rarityTierName(item, rarity, t)}</span> : null}
            </span>
            {isNew ? <span className="c14-row__new">{t("achievements.newArrival")}</span> : null}
          </div>
          <p className="c14-row__condition">{achievementCondition(item, t)}</p>
        </div>
        <RowRecord item={item} onOpenDay={onOpenDay} />
      </div>
      {open ? (
        <div id={openId} className="c14-open">
          <OpenedFacts item={item} />
          <OpenedDays item={item} onOpenDay={onOpenDay} />
        </div>
      ) : null}
    </section>
  );
}
