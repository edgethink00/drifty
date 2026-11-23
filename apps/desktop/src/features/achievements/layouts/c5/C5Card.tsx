import { useState, type CSSProperties } from "react";
import { readAchievementStore } from "../../achievementStore";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementDefinition, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementName, rarityIsNotable, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C5Medal } from "./C5Medal";
import "./c5-card.css";

const COLUMNS: Readonly<Record<AchievementGroup, number>> = { focus: 4, rhythm: 3, consistency: 4, unexpected: 3 };
const ARRIVAL_START_MS = 140;
const ARRIVAL_STEP_MS = 120;
/** However many arrive, the last one lands by about a second. */
const ARRIVAL_SPAN_MS = 900;
/** On the several card the companions start once the hero has settled. */
const COMPANIONS_AFTER_MS = 320;
/** On the single card the small medal drops into its slot as the hero settles. */
const SLOT_FILL_MS = 640;

/** An achievement not earned yet, drawn with the same locked art the tab uses. */
function lockedItem(definition: AchievementDefinition): AchievementItem {
  return { definition, earned: null, progress: null, rarity: null };
}

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
                  ) : <span className="c5-socket"><C5Medal item={lockedItem(definition)} className="c5-medal--locked" /></span>}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The groups the new medals landed in, each as its whole board row: medals earned
 * before, the new ones arriving on lit plates, locked art on sockets for the rest.
 */
function BoardExcerpt({ items, delays }: { readonly items: readonly AchievementItem[]; readonly delays: ReadonlyMap<AchievementId, number> }) {
  const { t } = useLocalization();
  const [earnedBefore] = useState(() => readAchievementStore().earned);
  const byId = new Map(items.map((item) => [item.definition.id, item]));
  const groups = ACHIEVEMENT_GROUPS.filter((group) => items.some((item) => item.definition.group === group));
  return (
    <div className="c5-excerpt" data-groups={groups.length} aria-hidden="true">
      {groups.map((group) => (
        <div key={group} className="c5-excerpt__group">
          <span className="c5-excerpt__label">{t(("achievements.group." + group) as TranslationKey)}</span>
          <span className="c5-excerpt__slots">
            {ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => {
              const item = byId.get(definition.id);
              if (item) {
                return (
                  <span key={definition.id} className="c5-excerpt__slot is-new">
                    <span className="c5-mini__arrival" style={{ "--c5-delay": (delays.get(definition.id) ?? 0) + "ms" } as CSSProperties}>
                      <C5Medal item={item} />
                    </span>
                  </span>
                );
              }
              const earned = earnedBefore[definition.id];
              return (
                <span key={definition.id} className="c5-excerpt__slot">
                  {earned
                    ? <C5Medal item={{ ...lockedItem(definition), earned }} />
                    : <span className="c5-socket"><C5Medal item={lockedItem(definition)} className="c5-medal--locked" /></span>}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The lead's group as it stands on the board: medals earned before, the new one on a lit plate, locked art for the rest. */
function GroupRow({ lead }: { readonly lead: AchievementItem }) {
  const { t } = useLocalization();
  const [earnedBefore] = useState(() => readAchievementStore().earned);
  const group = lead.definition.group;
  const definitions = ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group);
  const earnedCount = definitions.filter((definition) => definition.id === lead.definition.id || earnedBefore[definition.id]).length;
  return (
    <div className="c5-row">
      <span className="c5-row__head">
        <span className="c5-row__label">{t(("achievements.group." + group) as TranslationKey)}</span>
        <span className="c5-row__count">{earnedCount}/{definitions.length}</span>
      </span>
      <span className="c5-row__slots" aria-hidden="true">
        {definitions.map((definition) => {
          if (definition.id === lead.definition.id) {
            return (
              <span key={definition.id} className="c5-row__slot is-new">
                <span className="c5-mini__arrival" style={{ "--c5-delay": SLOT_FILL_MS + "ms" } as CSSProperties}>
                  <C5Medal item={lead} />
                </span>
              </span>
            );
          }
          const earned = earnedBefore[definition.id];
          return (
            <span key={definition.id} className="c5-row__slot">
              {earned
                ? <C5Medal item={{ ...lockedItem(definition), earned }} />
                : <span className="c5-socket"><C5Medal item={lockedItem(definition)} className="c5-medal--locked" /></span>}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function RarityLine({ item, t, language }: { readonly item: AchievementItem; readonly t: Translate; readonly language: DisplayLanguage }) {
  const rarity = shownRarity(item);
  if (!rarity) return null;
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
          <p className="c5-card__line">{t("achievements.summary", { earned: ordered.length, total: ACHIEVEMENT_DEFINITIONS.length })}</p>
        </div>
        {rarest && rarestRarity ? (
          <div className="c5-card__shelf c5-card__rarest">
            <span className="c5-excerpt__slot"><C5Medal item={rarest} /></span>
            <span className="c5-card__rarest-words">
              <strong className="c5-card__rarest-lead">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</strong>
              <span>{raritySentence(rarestRarity, t, effectiveLanguage, "tab")}</span>
            </span>
          </div>
        ) : null}
        {actions}
      </>
    );
  }

  if (several) {
    const touched = new Set(ordered.map((item) => item.definition.group)).size;
    // The lead lands in its slot together with the hero; the companions follow it in reading order.
    const delays = new Map([...arrivalDelays(boardOrder(others))].map(([id, delay]) => [id, delay + COMPANIONS_AFTER_MS]));
    delays.set(lead.definition.id, ARRIVAL_START_MS);
    return (
      <>
        <div className="c5-card__stage c5-card__stage--lead">
          <span className="c5-card__floor" aria-hidden="true" />
          <span className="c5-card__hero"><C5Medal item={lead} /></span>
        </div>
        <div className="c5-card__text">
          <p className="c5-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
          <h2 id={titleId} className="c5-card__title">{achievementName(lead, t)}</h2>
          <RarityLine item={lead} t={t} language={effectiveLanguage} />
        </div>
        <div className="c5-card__shelf">
          <BoardExcerpt items={ordered} delays={delays} />
          <p className="c5-card__groups">
            {touched === 1 ? t("achievements.c5.groupsOne") : t("achievements.c5.groupsMany", { count: touched })}
            <span className="c5-visually-hidden">{" " + t("achievements.dialog.alsoEarned") + " " + others.map((item) => achievementName(item, t)).join(", ")}</span>
          </p>
        </div>
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
        <p className="c5-card__line c5-card__line--condition">{achievementCondition(lead, t)}</p>
      </div>
      <div className="c5-card__shelf c5-card__shelf--single">
        <GroupRow lead={lead} />
      </div>
      {actions}
    </>
  );
}
