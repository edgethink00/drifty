import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS } from "../../achievementCatalog";
import { achievementHoldings, almostThere, type AlmostThereEntry } from "../../achievementCollection";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C9Held, C9Medal } from "./C9Parts";
import { nearLeft, percentText, shortDay } from "./c9Copy";
import "./c9-card.css";

/** Rows arrive one after another, this far apart. */
const ROW_STEP_MS = 70;
const FIRST_ROW_AT_MS = 160;

/** The goal closest to done among the ones not just earned, from the saved record. */
function useNextGoal(ordered: readonly AchievementItem[]): AlmostThereEntry | null {
  return useMemo(() => {
    const fresh = new Map(ordered.map((item) => [item.definition.id, item]));
    const items = buildAchievementItems(readAchievementStore()).map((item) => fresh.get(item.definition.id) ?? item);
    return almostThere(items, { limit: items.length }).find((entry) => !fresh.has(entry.item.definition.id)) ?? null;
  }, [ordered]);
}

function Columns({ rarityShown }: { readonly rarityShown: boolean }) {
  const { t } = useLocalization();
  return (
    <div className="c9c-cols" aria-hidden="true">
      <span className="c9c-cols__name">{t("achievements.c9.col.name")}</span>
      <span className="c9c-cols__times">{t("achievements.c9.col.times")}</span>
      {rarityShown ? <span className="c9c-cols__rarity">{t("achievements.c9.col.rarity")}</span> : null}
      <span className="c9c-cols__day">{t("achievements.stat.earnedOn")}</span>
    </div>
  );
}

type RowProps = {
  readonly item: AchievementItem;
  readonly rarityShown: boolean;
  /** "19th" for a new repeat, "×19" when listing what is held. */
  readonly count: "nth" | "times";
  readonly at: number;
  readonly lit?: boolean;
  readonly isNew?: boolean;
  /** The lit row's name is the card title. */
  readonly title?: ReactNode;
  readonly more?: ReactNode;
};

function Row({ item, rarityShown, count, at, lit = false, isNew = false, title, more }: RowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const day = achievementDay(item);
  const once = !definition.repeatable || (count === "times" && earned?.count === 1);
  const times = !earned ? null
    : once ? timesLabel(1, t)
      : count === "nth" ? t("achievements.c9.nth", { count: earned.count })
        : t("achievements.c9.times", { count: earned.count });
  return (
    <div className="c9c-row" data-lit={lit ? "true" : undefined} style={{ "--c9c-at": at + "ms" } as CSSProperties}>
      <C9Medal item={item} small={!lit} className="c9-medal c9c-row__medal" />
      <span className="c9c-row__name">
        {title ?? (
          <>
            {isNew ? <span className="c9c-dot" aria-hidden="true" /> : null}
            {achievementName(item, t)}
          </>
        )}
      </span>
      <span className="c9c-row__times" data-once={once ? "true" : undefined}>{times}</span>
      {rarityShown ? (
        <span className="c9c-row__rarity" data-notable={rarity && rarityIsNotable(item, rarity) ? "true" : undefined}>
          {rarity ? rarityTierName(item, rarity, t) : null}
        </span>
      ) : null}
      <span className="c9c-row__day">{day ? shortDay(day, effectiveLanguage) : null}</span>
      {more ? <div className="c9c-row__more">{more}</div> : null}
    </div>
  );
}

/** The next almost-there goal as the row that follows the new ones. */
function NextRow({ entry, at }: { readonly entry: AlmostThereEntry; readonly at: number }) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <div className="c9c-next" style={{ "--c9c-at": at + "ms" } as CSSProperties}>
      <p className="c9c-next__label">{t("achievements.near.title")}</p>
      <div className="c9c-row c9c-row--next">
        <C9Medal item={entry.item} small className="c9-medal c9c-row__medal" />
        <span className="c9c-row__name">{achievementName(entry.item, t)}</span>
        <span className="c9c-goal">
          <span className="c9c-goal__left">{nearLeft(entry, t, effectiveLanguage)}</span>
          <span className="c9c-bar" aria-hidden="true"><span style={{ "--c9-share": entry.share } as CSSProperties} /></span>
          <span className="c9c-goal__share">{percentText(entry.share, effectiveLanguage)}</span>
        </span>
      </div>
    </div>
  );
}

/** Under the lit row's name: what it means, how rare, and when it was first earned for a repeat. */
function LitMore({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(item);
  const earned = item.earned;
  return (
    <>
      <p className="c9c-lit__condition">{achievementCondition(item, t)}</p>
      {rarity ? <p className="c9c-lit__rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
      {earned && earned.count > 1 ? (
        <p className="c9c-lit__first">{t("achievements.c9.firstDay")} {formatAchievementDay(earned.firstDay, effectiveLanguage)}</p>
      ) : null}
    </>
  );
}

/** One or several new: a table excerpt, the lead lit with all its columns, the others under it, then the next goal. */
function Excerpt({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const [lead, ...others] = ordered;
  const next = useNextGoal(ordered);
  const rarityShown = ordered.some((item) => shownRarity(item) !== null);
  const nextAt = FIRST_ROW_AT_MS + (others.length + 1) * ROW_STEP_MS + 280;
  return (
    <>
      <p className="c9c-eyebrow">
        {others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
      </p>
      <div className="c9c-table" data-rarity={rarityShown ? "shown" : "none"}>
        <Columns rarityShown={rarityShown} />
        <Row
          item={lead}
          rarityShown={rarityShown}
          count="nth"
          at={FIRST_ROW_AT_MS}
          lit
          title={<h2 id={titleId} className="c9c-title">{achievementName(lead, t)}</h2>}
          more={<LitMore item={lead} />}
        />
        {others.map((item, index) => (
          <Row key={item.definition.id} item={item} rarityShown={rarityShown} count="nth" isNew at={FIRST_ROW_AT_MS + 280 + (index + 1) * ROW_STEP_MS} />
        ))}
        {next ? <NextRow entry={next} at={nextAt} /> : null}
      </div>
    </>
  );
}

/** First look: what was found, its tiers on top, the found rows under their groups. */
function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const holdings = achievementHoldings(ordered);
  const rarityShown = ordered.some((item) => shownRarity(item) !== null);
  const groups = ACHIEVEMENT_GROUPS
    .map((group) => ({ group, items: ordered.filter((item) => item.definition.group === group) }))
    .filter(({ items }) => items.length > 0);
  let row = 0;
  return (
    <>
      <div className="c9c-look-head">
        <h2 id={titleId} className="c9c-title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c9c-look-head__body">{t("achievements.dialog.firstLookBody")}</p>
        {holdings ? <C9Held holdings={holdings} className="c9-held c9c-held" /> : null}
      </div>
      <div className="c9c-table c9c-table--look" data-rarity={rarityShown ? "shown" : "none"}>
        <Columns rarityShown={rarityShown} />
        {groups.map(({ group, items }) => (
          <section key={group} className="c9c-group" aria-label={t(("achievements.group." + group) as TranslationKey)}>
            <p className="c9c-group__title" aria-hidden="true">{t(("achievements.group." + group) as TranslationKey)}</p>
            {items.map((item) => (
              <Row key={item.definition.id} item={item} rarityShown={rarityShown} count="times" at={FIRST_ROW_AT_MS + row++ * ROW_STEP_MS} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

export function C9Card({ ordered, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <div className="c9c">
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} /> : <Excerpt ordered={ordered} titleId={titleId} />}
      <div className="c9c-actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </div>
  );
}
