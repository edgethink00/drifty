import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementName, rarityIsNotable, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C5Medal } from "./C5Medal";
import "./c5-card.css";

const COLUMNS: Readonly<Record<AchievementGroup, number>> = { focus: 4, rhythm: 3, consistency: 4, unexpected: 3 };
/** Names listed after "Also earned" before the rest are counted. */
const OTHERS_NAMED = 3;
const ARRIVAL_START_MS = 140;
const ARRIVAL_STEP_MS = 120;
/** However many arrive, the last one lands by about a second. */
const ARRIVAL_SPAN_MS = 900;

function arrivalDelays(ids: readonly AchievementId[]): Map<AchievementId, number> {
  const step = ids.length > 1 ? Math.min(ARRIVAL_STEP_MS, ARRIVAL_SPAN_MS / (ids.length - 1)) : 0;
  return new Map(ids.map((id, index) => [id, Math.round(ARRIVAL_START_MS + index * step)]));
}

/** The tab's board in small: every slot of the collection, the new medals arriving in theirs. */
function SmallBoard({ items, delays }: { readonly items: readonly AchievementItem[]; readonly delays: ReadonlyMap<AchievementId, number> }) {
  const { t } = useLocalization();
  const byId = new Map(items.map((item) => [item.definition.id, item]));
  return (
    <div className="c5-mini" aria-hidden="true">
      {ACHIEVEMENT_GROUPS.map((group) => (
        <div key={group} className="c5-mini__group" data-group={group}>
          <span className="c5-mini__label">{t(("achievements.group." + group) as TranslationKey)}</span>
          <span className="c5-mini__slots" style={{ gridTemplateColumns: `repeat(${COLUMNS[group]}, minmax(0, 1fr))` }}>
            {ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => {
              const item = byId.get(definition.id);
              return (
                <span key={definition.id} className="c5-mini__slot">
                  {item ? (
                    <span className="c5-mini__arrival" style={{ "--c5-delay": (delays.get(definition.id) ?? 0) + "ms" } as CSSProperties}>
                      <C5Medal item={item} />
                    </span>
                  ) : <span className="c5-mini__socket" />}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

function RarityLine({ item, t, language }: { readonly item: AchievementItem; readonly t: Translate; readonly language: DisplayLanguage }) {
  const rarity = shownRarity(item);
  if (!rarity) return <p className="c5-card__line">{achievementCondition(item, t)}</p>;
  return (
    <p className="c5-card__line">
      <strong className="c5-card__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
      <span className="c5-sep" aria-hidden="true">·</span>
      <span>{raritySentence(rarity, t, language, "card")}</span>
    </p>
  );
}

function boardOrder(items: readonly AchievementItem[]): AchievementId[] {
  const found = new Set(items.map((item) => item.definition.id));
  return ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id).filter((id) => found.has(id));
}

/** One medal held up alone; several, or the first look back, arrive into the board they belong to. */
export function C5Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const several = others.length > 0;

  const actions = (
    <div className="c5-card__actions">
      <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
      <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
    </div>
  );

  if (showFirstLook) {
    const reading = boardOrder(ordered);
    const byId = new Map(ordered.map((item) => [item.definition.id, item]));
    const rarest = ordered
      .filter((item) => shownRarity(item) !== null)
      .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
    const rarestRarity = rarest ? shownRarity(rarest) : null;
    return (
      <>
        <SmallBoard items={ordered} delays={arrivalDelays(reading)} />
        <div className="c5-card__text">
          <p className="c5-card__eyebrow">{t("achievements.dialog.firstLookEyebrow")}</p>
          <h2 id={titleId} className="c5-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
          <p className="c5-card__line">{t("achievements.dialog.firstLookBody")}</p>
        </div>
        <p className="c5-card__names">
          {reading.map((id, index) => {
            const item = byId.get(id);
            return item ? <span key={id}>{achievementName(item, t)}{index < reading.length - 1 ? <span className="c5-sep" aria-hidden="true">·</span> : null}</span> : null;
          })}
        </p>
        {rarest && rarestRarity ? (
          <p className="c5-card__rarest">
            <span className="c5-card__rarest-lead">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</span>
            <span className="c5-sep" aria-hidden="true">·</span>
            <span>{raritySentence(rarestRarity, t, effectiveLanguage, "tab")}</span>
          </p>
        ) : null}
        {actions}
      </>
    );
  }

  if (several) {
    const named = others.slice(0, OTHERS_NAMED);
    const more = others.length - named.length;
    return (
      <>
        <SmallBoard items={ordered} delays={arrivalDelays(ordered.map((item) => item.definition.id))} />
        <div className="c5-card__text">
          <p className="c5-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
          <h2 id={titleId} className="c5-card__title">{achievementName(lead, t)}</h2>
          <RarityLine item={lead} t={t} language={effectiveLanguage} />
        </div>
        <p className="c5-card__names">
          <span className="c5-card__names-label">{t("achievements.dialog.alsoEarned")}</span>
          {named.map((item, index) => (
            <span key={item.definition.id}>
              {achievementName(item, t)}
              {index < named.length - 1 || more > 0 ? <span className="c5-sep" aria-hidden="true">·</span> : null}
            </span>
          ))}
          {more > 0 ? <span>{t("achievements.dialog.more", { count: more })}</span> : null}
        </p>
        {actions}
      </>
    );
  }

  return (
    <>
      <div className="c5-card__stage">
        <span className="c5-card__floor" aria-hidden="true" />
        <span className="c5-card__hero"><C5Medal item={lead} /></span>
      </div>
      <div className="c5-card__text">
        <p className="c5-card__eyebrow">{t("achievements.dialog.eyebrow")}</p>
        <h2 id={titleId} className="c5-card__title">{achievementName(lead, t)}</h2>
        <RarityLine item={lead} t={t} language={effectiveLanguage} />
      </div>
      {actions}
    </>
  );
}
