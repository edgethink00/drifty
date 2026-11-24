import type { CSSProperties } from "react";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import { achievementCondition, achievementDay, achievementName, medalName, raritySentence, shownRarity } from "../../achievementCopy";
import { nextMedal } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C13Medal } from "./C13Medal";
import { ordinal, rowMeta, shortDay } from "./c13Copy";

const ROW_ENTER_AT_MS = 160;
const ROW_STEP_MS = 40;
const ROW_STEPS = 6;

function enterAt(index: number): CSSProperties {
  return { "--c13-enter-at": ROW_ENTER_AT_MS + Math.min(index, ROW_STEPS) * ROW_STEP_MS + "ms" } as CSSProperties;
}

/** "57th time · Silver" style run for a card: which time, then the tier with its share, or the medal without rarity. */
function cardMeta(item: AchievementItem, t: Translate, language: DisplayLanguage, { nth = true } = {}): string[] {
  const parts: string[] = [];
  const count = item.earned?.count ?? 0;
  if (nth && item.definition.repeatable && count > 1) parts.push(t("achievements.c13.nthTime", { nth: ordinal(count, t, language) }));
  const meta = rowMeta(item, t, language);
  const rarity = meta.find((part) => part.key === "rarity");
  const metal = medalName(item, t);
  if (rarity) parts.push(rarity.text);
  else if (metal) parts.push(metal);
  const group = meta.find((part) => part.key === "group");
  if (group) parts.push(group.text);
  return parts;
}

type TwoLinesProps = {
  readonly item: AchievementItem;
  readonly titleId?: string;
  readonly withMeta?: boolean;
};

function TwoLines({ item, titleId, withMeta = true }: TwoLinesProps) {
  const { effectiveLanguage, t } = useLocalization();
  const name = achievementName(item, t);
  const day = achievementDay(item);
  const meta = withMeta ? cardMeta(item, t, effectiveLanguage) : [];
  return (
    <div className="c13-lines">
      <div className="c13-lines__one">
        {titleId ? <h2 id={titleId} className="c13-lines__name">{name}</h2> : <span className="c13-lines__name">{name}</span>}
        {day ? <span className="c13-lines__day">{shortDay(day, effectiveLanguage)}</span> : null}
      </div>
      <p className="c13-lines__two">
        <span className="c13-lines__condition">{achievementCondition(item, t)}</span>
        {meta.length > 0 ? (
          <span className="c13-lines__meta">{meta.map((text) => <span key={text} className="c13-meta">{text}</span>)}</span>
        ) : null}
      </p>
    </div>
  );
}

function Note({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  const rarity = shownRarity(item);
  const next = nextMedal(item);
  const text = rarity ? raritySentence(rarity, t, effectiveLanguage, "card")
    : next ? t(next.key === "achievements.medal.toGold" ? "achievements.dialog.toGold" : "achievements.dialog.toRing", { remaining: next.remaining })
      : null;
  return text ? <p className="c13-card__note">{text}</p> : null;
}

function whenLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const day = achievementDay(item);
  if (!day) return null;
  const count = item.earned?.count ?? 0;
  const date = shortDay(day, language);
  return item.definition.repeatable && count > 1 ? t("achievements.c13.nthTime", { nth: ordinal(count, t, language) }) + " · " + date : date;
}

function Single({ lead, titleId }: { readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const when = whenLine(lead, t, effectiveLanguage);
  const meta = cardMeta(lead, t, effectiveLanguage, { nth: false });
  return (
    <>
      <p className="c13-card__eyebrow">{t("achievements.dialog.eyebrow")}</p>
      <div className="c13-card__single">
        <C13Medal item={lead} className="c13-medal c13-card__hero" />
        <div className="c13-card__label">
          <h2 id={titleId} className="c13-card__name">{achievementName(lead, t)}</h2>
          <p className="c13-card__condition">{achievementCondition(lead, t)}</p>
          {when ? <p className="c13-card__when">{when}</p> : null}
          {meta.length > 0 ? (
            <p className="c13-lines__meta c13-card__meta">{meta.map((text) => <span key={text} className="c13-meta">{text}</span>)}</p>
          ) : null}
          <Note item={lead} />
        </div>
      </div>
    </>
  );
}

function Several({ lead, others, ordered, titleId }: { readonly lead: AchievementItem; readonly others: readonly AchievementItem[]; readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <>
      <p className="c13-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
      <div className="c13-card__lead">
        <C13Medal item={lead} className="c13-medal c13-card__lead-medal" />
        <TwoLines item={lead} titleId={titleId} />
      </div>
      <ol className="c13-card__rows">
        {others.map((item, index) => (
          <li key={item.definition.id} className="c13-card__row" style={enterAt(index)}>
            <C13Medal item={item} small className="c13-medal c13-card__row-medal" />
            <TwoLines item={item} />
          </li>
        ))}
      </ol>
    </>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  return (
    <>
      <div className="c13-card__head">
        <h2 id={titleId} className="c13-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c13-card__body">{t("achievements.dialog.firstLookBody")}</p>
      </div>
      <ol className="c13-card__rows c13-card__rows--look">
        {ordered.map((item, index) => (
          <li key={item.definition.id} className="c13-card__row" style={enterAt(index)}>
            <C13Medal item={item} small className="c13-medal c13-card__row-medal" />
            <TwoLines item={item} withMeta={false} />
          </li>
        ))}
      </ol>
    </>
  );
}

/** The new-achievement card in the tab's row grammar: one large medal, or the lead large with the others as rows. */
export function C13Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several lead={lead} others={others} ordered={ordered} titleId={titleId} />
          : <Single lead={lead} titleId={titleId} />}
      <div className="c13-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
