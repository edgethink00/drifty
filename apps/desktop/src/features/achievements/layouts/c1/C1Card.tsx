import { useMemo } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay, medalName, raritySentence, shownRarity } from "../../achievementCopy";
import { readAchievementStore } from "../../achievementStore";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C1Medal, C1SwapMedal } from "./C1Medal";
import { rarestEarned } from "./c1Copy";
import "./c1-card.css";

/** Group rows drawn under the lead medal when several arrive; the rest are counted. */
const ROWS_SHOWN = 2;
/** When the new slots turn from locked to earned, after the large medal has risen. */
const SWAP_AT_MS = 500;
const FIRST_LOOK_SWAP_AT_MS = 320;
const FIRST_LOOK_STEP_MS = 50;

type Row = { readonly group: AchievementGroup; readonly items: readonly AchievementItem[] };

/** Every achievement of a group as it stands now: the new ones as given, the others from the saved record. */
function rowsFor(groups: readonly AchievementGroup[], fresh: readonly AchievementItem[], earlier: "saved" | "none"): Row[] {
  const byId = new Map(fresh.map((item) => [item.definition.id, item]));
  const saved = earlier === "saved" ? readAchievementStore().earned : {};
  return groups.map((group) => ({
    group,
    items: ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => byId.get(definition.id)
      ?? { definition, earned: saved[definition.id] ?? null, progress: null, rarity: null }),
  }));
}

type CardRowProps = {
  readonly row: Row;
  readonly fresh: ReadonlySet<AchievementId>;
  readonly names?: readonly string[];
};

function CardRow({ row, fresh, names }: CardRowProps) {
  const { t } = useLocalization();
  return (
    <div className="c1-card-row">
      <span className="c1-card-row__head">
        <span className="c1-card-row__title">{t(("achievements.group." + row.group) as TranslationKey)}</span>
        <span className="c1-card-row__count">{row.items.filter((item) => item.earned).length}/{row.items.length}</span>
      </span>
      <span className="c1-card-row__slots">
        {row.items.map((item) => (
          <span key={item.definition.id} className="c1-card-slot" data-new={fresh.has(item.definition.id) ? "true" : undefined}>
            {fresh.has(item.definition.id) ? <C1SwapMedal item={item} small delay={SWAP_AT_MS} /> : <C1Medal item={item} small />}
          </span>
        ))}
      </span>
      {names && names.length > 0 ? (
        <span className="c1-card-row__names">{names.map((name) => <span key={name}>{name}</span>)}</span>
      ) : null}
    </div>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const rows = useMemo(() => rowsFor(ACHIEVEMENT_GROUPS, ordered, "none"), [ordered]);
  const rarest = rarestEarned(ordered);
  let found = 0;
  return (
    <>
      <div className="c1-card__text">
        <h2 id={titleId} className="c1-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c1-card__condition">{t("achievements.dialog.firstLookBody")}</p>
        {rarest ? <p className="c1-card__rarest">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</p> : null}
      </div>
      <div className="c1-look">
        {rows.map((row) => (
          <section key={row.group} className="c1-look__row" aria-label={t(("achievements.group." + row.group) as TranslationKey)}>
            <span className="c1-look__head">
              <span className="c1-look__title">{t(("achievements.group." + row.group) as TranslationKey)}</span>
              <span className="c1-look__count">{row.items.filter((item) => item.earned).length}/{row.items.length}</span>
            </span>
            {row.items.map((item) => {
              const delay = item.earned ? FIRST_LOOK_SWAP_AT_MS + found++ * FIRST_LOOK_STEP_MS : 0;
              return (
                <span key={item.definition.id} className="c1-look__slot" data-state={item.earned ? "earned" : "locked"}>
                  {item.earned ? <C1SwapMedal item={item} small delay={delay} /> : <C1Medal item={item} small />}
                  <span className="c1-look__name">{achievementName(item, t)}</span>
                </span>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

/** The new medal rises onto the card, then takes its place in its group's row. */
export function C1Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const hero = rarestEarned(ordered) ?? lead;
  const fresh = useMemo(() => new Set(ordered.map((item) => item.definition.id)), [ordered]);
  const rows = useMemo(() => {
    const groups = [...new Set(ordered.map((item) => item.definition.group))];
    const newIn = (group: AchievementGroup) => ordered.filter((item) => item.definition.group === group).length;
    const rest = groups.filter((group) => group !== hero.definition.group)
      .sort((left, right) => newIn(right) - newIn(left) || ACHIEVEMENT_GROUPS.indexOf(left) - ACHIEVEMENT_GROUPS.indexOf(right));
    return rowsFor([hero.definition.group, ...rest].slice(0, ROWS_SHOWN), ordered, "saved");
  }, [hero, ordered]);
  const several = others.length > 0;
  const shown = new Set(rows.flatMap((row) => row.items.map((item) => item.definition.id)));
  const unshown = ordered.filter((item) => !shown.has(item.definition.id)).length;
  const rarity = shownRarity(hero);
  const day = hero.earned ? formatAchievementDay(achievementDay(hero) ?? hero.earned.firstDay, effectiveLanguage) : null;

  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} /> : (
        <>
          <div className="c1-card__stage">
            <C1Medal item={hero} className="c1-medal c1-card__hero" />
          </div>
          <div className="c1-card__text">
            <p className="c1-card__eyebrow">{several ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}</p>
            <h2 id={titleId} className="c1-card__title">{achievementName(hero, t)}</h2>
            <p className="c1-card__condition">{achievementCondition(hero, t)}</p>
            {rarity ? <p className="c1-card__rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
            {day ? <p className="c1-card__date">{[t("achievements.dialog.earnedOn", { date: day }), medalName(hero, t)].filter(Boolean).join(" · ")}</p> : null}
          </div>
          <div className="c1-card__rows" data-several={several ? "true" : undefined}>
            {rows.map((row) => (
              <CardRow
                key={row.group}
                row={row}
                fresh={fresh}
                names={several ? row.items.filter((item) => fresh.has(item.definition.id) && item !== hero).map((item) => achievementName(item, t)) : undefined}
              />
            ))}
            {unshown > 0 ? <p className="c1-card__more">{t("achievements.dialog.more", { count: unshown })}</p> : null}
          </div>
        </>
      )}
      <div className="c1-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
