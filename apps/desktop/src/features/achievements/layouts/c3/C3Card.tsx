import { useMemo, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { achievementBadgeStage, achievementBadgeUrl } from "../../achievementBadge";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityIsNotable,
  raritySentence,
  rarityTierName,
  shownRarity,
} from "../../achievementCopy";
import { AchievementMedal } from "../../AchievementMedal";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import "./c3-card.css";

/**
 * All thirteen as the book holds them now. The new ones come from the card;
 * the rest of a chapter is read from the stored record, except on the first
 * look, where everything not found is still empty.
 */
function bookItems(ordered: readonly AchievementItem[], firstLook: boolean): AchievementItem[] {
  const fresh = new Map(ordered.map((item) => [item.definition.id, item]));
  const stored = firstLook ? [] : buildAchievementItems(readAchievementStore());
  return ACHIEVEMENT_DEFINITIONS.map((definition) => fresh.get(definition.id)
    ?? stored.find((item) => item.definition.id === definition.id)
    ?? { definition, earned: null, progress: null, rarity: null });
}

type Row = {
  readonly group: AchievementGroup;
  readonly items: readonly AchievementItem[];
  readonly fresh: readonly AchievementItem[];
};

function Cell({ item, order, mark }: { readonly item: AchievementItem; readonly order: number | null; readonly mark: boolean }) {
  const { t } = useLocalization();
  const name = achievementName(item, t);
  const src = achievementBadgeUrl(item.definition.id, achievementBadgeStage(item), true);
  const before = order !== null ? achievementBadgeUrl(item.definition.id, item.definition.hidden ? "concealed" : "locked", true) : undefined;
  return (
    <span
      className="c3-cell"
      role="img"
      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
      title={name}
      data-fresh={order !== null ? "true" : undefined}
      data-mark={mark && order !== null ? "true" : undefined}
      style={order !== null ? ({ "--c3-order": order } as CSSProperties) : undefined}
    >
      {before ? <img className="c3-cell__image is-before" src={before} alt="" draggable={false} /> : null}
      {src ? <img className="c3-cell__image is-earned" src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

function ChapterRows({ rows, order, names, mark, strip }: {
  readonly rows: readonly Row[];
  readonly order: ReadonlyMap<AchievementId, number>;
  readonly names: boolean;
  readonly mark: boolean;
  readonly strip: boolean;
}) {
  const { t } = useLocalization();
  return (
    <ol className={strip ? "c3-rows is-strip" : "c3-rows"}>
      {rows.map(({ group, items, fresh }) => (
        <li key={group} className="c3-row">
          {strip ? null : (
            <span className="c3-row__head">
              <span className="c3-row__name">{t(("achievements.group." + group) as TranslationKey)}</span>
              <span className="c3-row__count">{items.filter((item) => item.earned).length}/{items.length}</span>
            </span>
          )}
          <span className="c3-row__slots">
            {items.map((item) => <Cell key={item.definition.id} item={item} order={order.get(item.definition.id) ?? null} mark={mark} />)}
          </span>
          {names ? (
            <span className="c3-row__names">
              {fresh.map((item) => <span key={item.definition.id} className="c3-row__fresh">{achievementName(item, t)}</span>)}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The medal set down on the card, then its chapter with the new slot filling; the first look shows the whole contents. */
export function C3Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const book = useMemo(() => bookItems(ordered, showFirstLook), [ordered, showFirstLook]);
  const freshIds = useMemo(() => new Set(ordered.map((item) => item.definition.id)), [ordered]);
  const rows: Row[] = ACHIEVEMENT_GROUPS
    .map((group) => {
      const items = book.filter((item) => item.definition.group === group);
      return { group, items, fresh: items.filter((item) => freshIds.has(item.definition.id)) };
    })
    .filter((row) => showFirstLook || row.fresh.length > 0);
  // Slots fill in reading order on the first look, and lead first otherwise.
  const fillOrder = new Map<AchievementId, number>(
    (showFirstLook ? rows.flatMap((row) => row.fresh) : ordered).map((item, index) => [item.definition.id, index]),
  );
  const leadRarity = shownRarity(lead);
  const rarest = ordered
    .filter((item) => shownRarity(item) !== null)
    .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
  const rarestRarity = rarest ? shownRarity(rarest) : null;
  const single = !showFirstLook && others.length === 0;
  const leadRow = rows.find((row) => row.group === lead.definition.group);
  const leadEarned = leadRow ? leadRow.items.filter((item) => item.earned).length : 0;
  const leadTotal = leadRow ? leadRow.items.length : 1;

  return (
    <>
      {showFirstLook ? (
        <div className="c3-card__text">
          <p className="c3-card__context">{t("achievements.dialog.firstLookEyebrow")}</p>
          <h2 id={titleId} className="c3-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
          <p className="c3-card__condition">{t("achievements.dialog.firstLookBody")}</p>
        </div>
      ) : (
        <>
          {single ? (
            <div className="c3-card__chapter">
              <span className="c3-card__chapter-name">{t(("achievements.group." + lead.definition.group) as TranslationKey)}</span>
              <span className="c3-card__chapter-count">{leadEarned}/{leadTotal}</span>
              <span className="c3-card__chapter-bar" aria-hidden="true">
                <span
                  style={{
                    width: Math.round((leadEarned / Math.max(1, leadTotal)) * 100) + "%",
                    "--c3-from": Math.max(0, leadEarned - 1) / Math.max(1, leadEarned),
                  } as CSSProperties}
                />
              </span>
            </div>
          ) : null}
          <div className="c3-card__stage">
            <span className="c3-card__floor" aria-hidden="true" />
            <span className="c3-card__drop"><AchievementMedal item={lead} size="xl" /></span>
          </div>
          <div className="c3-card__text">
            <p className="c3-card__context">
              {others.length > 0 ? t("achievements.dialog.eyebrowMany", { count: ordered.length }) : t("achievements.dialog.eyebrow")}
            </p>
            <h2 id={titleId} className="c3-card__title">{achievementName(lead, t)}</h2>
            <p className="c3-card__condition">{achievementCondition(lead, t)}</p>
            <div className="c3-card__facts">
              {leadRarity ? (
                <p className="c3-card__rarity">
                  <strong className="c3-card__tier" data-notable={rarityIsNotable(lead, leadRarity) ? "true" : undefined}>{rarityTierName(lead, leadRarity, t)}</strong>
                  <span>{raritySentence(leadRarity, t, effectiveLanguage, "card")}</span>
                </p>
              ) : null}
              {lead.earned ? (
                <p className="c3-card__date">
                  {t("achievements.dialog.earnedOn", { date: formatAchievementDay(achievementDay(lead) ?? lead.earned.firstDay, effectiveLanguage) })}
                  {" · "}
                  {medalName(lead, t)}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}

      <ChapterRows rows={rows} order={fillOrder} names={!showFirstLook && others.length > 0} mark={!showFirstLook} strip={single} />

      {showFirstLook && rarest && rarestRarity ? (
        <p className="c3-card__rarest">
          <strong>{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</strong>
          <span> · {raritySentence(rarestRarity, t, effectiveLanguage, "tab")}</span>
        </p>
      ) : null}

      <div className="c3-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
