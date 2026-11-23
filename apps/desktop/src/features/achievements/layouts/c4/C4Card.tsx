import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import { achievementName, medalName, rarityIsNotable, raritySentence, rarityTierName, shownRarity } from "../../achievementCopy";
import { nextMedal } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { didLine, entryDay, journalDate, medalSource, shortDay } from "./c4Journal";
import { placeOnYear } from "./c4Timeline";
import "./c4-card.css";

/** Entries listed on the several-at-once card before the rest are counted. */
const ENTRIES_SHOWN = 4;
/** Same breakpoint as the stylesheets' smallest window; the first look then shows half a year. */
const NARROW_QUERY = "(max-width: 1100px)";

function medalLine(item: AchievementItem, t: Translate): string {
  const next = nextMedal(item);
  const parts = [medalName(item, t)];
  if (item.definition.repeatable && item.earned && item.earned.count > 1) parts.push(t("achievements.dialog.timesNth", { count: item.earned.count }));
  if (next) parts.push(t(next.key === "achievements.medal.toGold" ? "achievements.dialog.toGold" : "achievements.dialog.toRing", { remaining: next.remaining }));
  return parts.filter(Boolean).join(" · ");
}

function SingleCard({ lead, titleId, t, language }: { readonly lead: AchievementItem; readonly titleId: string; readonly t: Translate; readonly language: DisplayLanguage }) {
  const rarity = shownRarity(lead);
  const src = medalSource(lead, false);
  const day = entryDay(lead);
  return (
    <>
      <header className="c4c-head">
        <p className="c4c-head__context">{t("achievements.dialog.eyebrow")}</p>
        <p className="c4c-head__date"><time dateTime={day}>{journalDate(day, language)}</time></p>
      </header>
      <div className="c4c-stage">
        <span className="c4c-stage__floor" aria-hidden="true" />
        {src ? <img className="c4c-stage__medal" src={src} alt="" draggable={false} /> : null}
      </div>
      <div className="c4c-body">
        <p className="c4c-that-day">{t("achievements.c4.card.thatDay")}</p>
        <h2 id={titleId} className="c4c-title">{achievementName(lead, t)}</h2>
        <p className="c4c-did">{didLine(lead, t)}</p>
        <dl className="c4c-facts">
          {rarity ? (
            <div className="c4c-facts__row">
              <dt>{t("achievements.rarity.title")}</dt>
              <dd>
                <strong className="c4c-tier" data-notable={rarityIsNotable(lead, rarity) ? "true" : undefined}>{rarityTierName(lead, rarity, t)}</strong>
                <span className="c4c-sep" aria-hidden="true">·</span>
                {raritySentence(rarity, t, language, "card")}
              </dd>
            </div>
          ) : null}
          <div className="c4c-facts__row">
            <dt>{t("achievements.medal.title")}</dt>
            <dd>{medalLine(lead, t)}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}

function SeveralCard({ ordered, lead, titleId, t, language }: {
  readonly ordered: readonly AchievementItem[];
  readonly lead: AchievementItem;
  readonly titleId: string;
  readonly t: Translate;
  readonly language: DisplayLanguage;
}) {
  const shown = ordered.slice(0, ENTRIES_SHOWN);
  const leadDay = entryDay(lead);
  const days = [leadDay, ...[...new Set(shown.map(entryDay))].filter((day) => day !== leadDay).sort((left, right) => right.localeCompare(left))];
  let index = 0;
  return (
    <>
      <header className="c4c-head">
        <p className="c4c-head__context">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
      </header>
      <div className="c4c-days">
        {days.map((day) => (
          <section key={day} className="c4c-day" aria-label={journalDate(day, language)}>
            <p className="c4c-day__date c4c-enter" style={{ "--c4c-i": index } as CSSProperties}><time dateTime={day}>{journalDate(day, language)}</time></p>
            <ul className="c4c-entries">
              {shown.filter((item) => entryDay(item) === day).map((item) => {
                index += 1;
                const rarity = shownRarity(item);
                const src = medalSource(item, false);
                const isLead = item === lead;
                return (
                  <li key={item.definition.id} className="c4c-entry c4c-enter" data-lead={isLead ? "true" : undefined} style={{ "--c4c-i": index } as CSSProperties}>
                    <span className="c4c-entry__medal">{src ? <img className="c4c-medal-img" src={src} alt="" draggable={false} /> : null}</span>
                    <span className="c4c-entry__text">
                      {isLead
                        ? <h2 id={titleId} className="c4c-entry__name">{achievementName(item, t)}</h2>
                        : <span className="c4c-entry__name">{achievementName(item, t)}</span>}
                      <span className="c4c-entry__did">{didLine(item, t)}</span>
                      <span className="c4c-entry__meta">
                        {rarity ? (
                          <span className="c4c-entry__chunk">
                            <strong className="c4c-tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, t)}</strong>
                          </span>
                        ) : null}
                        <span className="c4c-entry__chunk">{medalLine(item, t)}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {ordered.length > ENTRIES_SHOWN ? (
        <p className="c4c-more c4c-enter" style={{ "--c4c-i": index + 1 } as CSSProperties}>{t("achievements.dialog.more", { count: ordered.length - ENTRIES_SHOWN })}</p>
      ) : null}
    </>
  );
}

function FirstLookCard({ ordered, titleId, t, language }: {
  readonly ordered: readonly AchievementItem[];
  readonly titleId: string;
  readonly t: Translate;
  readonly language: DisplayLanguage;
}) {
  const narrow = typeof window !== "undefined" && window.matchMedia?.(NARROW_QUERY).matches === true;
  const { places, months, before } = placeOnYear(ordered, language, narrow ? 6 : 12);
  const rarest = ordered
    .filter((item) => shownRarity(item) !== null)
    .sort((left, right) => (left.rarity?.percent ?? 100) - (right.rarity?.percent ?? 100) || right.definition.weight - left.definition.weight)[0];
  const rarestRarity = rarest ? shownRarity(rarest) : null;
  return (
    <>
      <header className="c4c-head c4c-head--look">
        <p className="c4c-head__context">{t("achievements.dialog.firstLookEyebrow")}</p>
        <h2 id={titleId} className="c4c-look-title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c4c-look-body">{t("achievements.dialog.firstLookBody")}</p>
      </header>
      <div className="c4t">
        <ol className="c4t__items">
          {places.map((place, index) => {
            const src = medalSource(place.item, true);
            const day = place.item.earned?.firstDay ?? "";
            return (
              <li
                key={place.item.definition.id}
                className="c4t__item"
                data-lane={place.lane}
                data-align={place.align}
                style={{
                  "--c4t-x": place.x + "%",
                  "--c4t-left": place.labelLeft + "%",
                  "--c4t-width": place.labelWidth + "%",
                  "--c4t-i": index,
                } as CSSProperties}
              >
                <span className="c4t__medal">{src ? <img className="c4c-medal-img" src={src} alt="" draggable={false} /> : null}</span>
                <span className="c4t__label">
                  <span className="c4t__name">{achievementName(place.item, t)}</span>
                  <time className="c4t__date" dateTime={day}>{shortDay(day, language)}</time>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="c4t__axis" aria-hidden="true">
          {months.map((month) => (
            <span key={month.key} className="c4t__month" style={{ left: month.start + "%", width: month.width + "%" }}>{month.label}</span>
          ))}
        </div>
        {before > 0 ? <p className="c4t__before">{t("achievements.c4.card.before", { count: before })}</p> : null}
      </div>
      {rarest && rarestRarity ? (
        <p className="c4c-rarest">
          <span className="c4c-rarest__lead">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</span>
          <span className="c4c-sep" aria-hidden="true">·</span>
          {raritySentence(rarestRarity, t, language, "tab")}
        </p>
      ) : null}
    </>
  );
}

/** A page of the journal: the day first, then what was earned on it; the first look lays the year out as a line. */
export function C4Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { effectiveLanguage: language, t } = useLocalization();
  return (
    <>
      {showFirstLook
        ? <FirstLookCard ordered={ordered} titleId={titleId} t={t} language={language} />
        : others.length > 0
          ? <SeveralCard ordered={ordered} lead={lead} titleId={titleId} t={t} language={language} />
          : <SingleCard lead={lead} titleId={titleId} t={t} language={language} />}
      <div className="c4c-actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
