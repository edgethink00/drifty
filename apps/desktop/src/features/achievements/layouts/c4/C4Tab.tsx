import { useRef, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementName, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C4Detail } from "./C4Detail";
import {
  aheadEntries,
  didLine,
  entryDay,
  journalDate,
  journalDayNumber,
  journalEntries,
  journalMonth,
  journalWeekday,
  medalSource,
  nextLine,
  prefersReducedMotion,
  rarityPercent,
  recordLine,
} from "./c4Journal";
import "./c4-tab.css";

/** Entries that rise in turn on arrival; later ones arrive with the last. */
const STAGGERED = 12;

function rise(index: number): CSSProperties {
  return { "--c4-i": Math.min(index, STAGGERED) } as CSSProperties;
}

type RowContext = {
  readonly t: Translate;
  readonly language: DisplayLanguage;
  readonly selectedId: AchievementId | undefined;
  readonly showRarity: boolean;
  readonly choose: (id: AchievementId) => void;
};

function RarityCell({ item, context, caption = false }: { readonly item: AchievementItem; readonly context: RowContext; readonly caption?: boolean }) {
  if (!context.showRarity) return null;
  const rarity = shownRarity(item);
  const percent = rarityPercent(item, context.t, context.language);
  return (
    <span className="c4-rarity">
      {caption ? <span className="c4-rarity__caption">{context.t("achievements.c4.rarityColumn")}</span> : null}
      {rarity && percent ? (
        <>
          <span className="c4-rarity__value">{percent}</span>
          <span className="c4-rarity__tier" data-notable={rarityIsNotable(item, rarity) ? "true" : undefined}>{rarityTierName(item, rarity, context.t)}</span>
        </>
      ) : null}
    </span>
  );
}

function EarnedLines({ item, context, isNew }: { readonly item: AchievementItem; readonly context: RowContext; readonly isNew: boolean }) {
  const { t, language } = context;
  const next = nextLine(item, t);
  return (
    <>
      <span className="c4-entry__did">{didLine(item, t)}</span>
      <span className="c4-entry__meta">
        {isNew ? <span className="c4-entry__chunk c4-entry__new"><span className="c4-dot" aria-hidden="true" />{t("achievements.newArrival")}</span> : null}
        <span className="c4-entry__chunk">{recordLine(item, t, language)}</span>
        {next ? <span className="c4-entry__chunk">{next}</span> : null}
      </span>
    </>
  );
}

function LeadEntry({ item, context, isNew, aheadCount, onOpenDay, onJump }: {
  readonly item: AchievementItem;
  readonly context: RowContext;
  readonly isNew: boolean;
  readonly aheadCount: number;
  readonly onOpenDay: (day: string) => void;
  readonly onJump: () => void;
}) {
  const { t, language } = context;
  const day = entryDay(item);
  const selected = item.definition.id === context.selectedId;
  const src = medalSource(item, false);
  return (
    <article className="c4-lead c4-rise" style={rise(0)}>
      <div className="c4-lead__head">
        <p className="c4-lead__date">
          <span className="c4-lead__latest">{t("achievements.c4.latest")}</span>
          <span className="c4-sep" aria-hidden="true">·</span>
          <time dateTime={day}>{journalDate(day, language)}</time>
        </p>
        {aheadCount > 0 ? (
          <button type="button" className="c4-jump" onClick={onJump}>{t("achievements.c4.ahead.jump", { count: aheadCount })}</button>
        ) : null}
      </div>
      <button
        type="button"
        className="c4-pick c4-lead__pick"
        data-state="earned"
        aria-pressed={selected}
        onClick={() => context.choose(item.definition.id)}
      >
        <span className="c4-lead__medal">
          <span className="c4-lead__floor" aria-hidden="true" />
          {src ? <img className="c4-medal-img" src={src} alt="" draggable={false} /> : null}
        </span>
        <span className="c4-lead__text">
          <span className="c4-lead__name">{achievementName(item, t)}</span>
          <EarnedLines item={item} context={context} isNew={isNew} />
        </span>
        <RarityCell item={item} context={context} caption />
      </button>
      <div className="c4-lead__actions">
        <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => onOpenDay(day)}>{t("achievements.openDay")}</button>
      </div>
    </article>
  );
}

function EarnedRow({ item, context, isNew, index, onOpenDay }: {
  readonly item: AchievementItem;
  readonly context: RowContext;
  readonly isNew: boolean;
  readonly index: number;
  readonly onOpenDay: (day: string) => void;
}) {
  const { t, language } = context;
  const day = entryDay(item);
  const fullDate = journalDate(day, language);
  const src = medalSource(item, false);
  return (
    <li className="c4-row c4-rise" data-state="earned" style={rise(index)}>
      <button
        type="button"
        className="c4-day"
        aria-label={t("achievements.c4.openDayFor", { date: fullDate })}
        title={t("achievements.c4.openDayFor", { date: fullDate })}
        onClick={() => onOpenDay(day)}
      >
        <span className="c4-day__num">{journalDayNumber(day)}</span>
        <span className="c4-day__weekday">{journalWeekday(day, language)}</span>
      </button>
      <button
        type="button"
        className="c4-pick c4-row__pick"
        data-state="earned"
        aria-pressed={item.definition.id === context.selectedId}
        onClick={() => context.choose(item.definition.id)}
      >
        <span className="c4-row__medal">{src ? <img className="c4-medal-img" src={src} alt="" draggable={false} /> : null}</span>
        <span className="c4-row__text">
          <span className="c4-entry__name">{achievementName(item, t)}</span>
          <EarnedLines item={item} context={context} isNew={isNew} />
        </span>
        <RarityCell item={item} context={context} />
      </button>
    </li>
  );
}

function AheadRow({ item, context, index }: { readonly item: AchievementItem; readonly context: RowContext; readonly index: number }) {
  const { t, language } = context;
  const progress = progressText(item, t, language);
  const remaining = progress ? remainingText(item, t, language) : null;
  const src = medalSource(item, false);
  return (
    <li className="c4-row c4-rise" data-state="locked" style={rise(index)}>
      <span className="c4-day c4-day--empty" aria-hidden="true" />
      <button
        type="button"
        className="c4-pick c4-row__pick"
        data-state="locked"
        aria-pressed={item.definition.id === context.selectedId}
        onClick={() => context.choose(item.definition.id)}
      >
        <span className="c4-row__medal">{src ? <img className="c4-medal-img" src={src} alt="" draggable={false} /> : null}</span>
        <span className="c4-row__text">
          <span className="c4-entry__name">{achievementName(item, t)}</span>
          <span className="c4-entry__did">{achievementCondition(item, t)}</span>
          {progress ? (
            <span className="c4-progress">
              <span className="c4-progress__bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
              <span className="c4-progress__text">{progress}<span className="c4-sep" aria-hidden="true">·</span>{remaining}</span>
            </span>
          ) : null}
        </span>
        <RarityCell item={item} context={context} />
      </button>
    </li>
  );
}

function C4Loading({ label }: { readonly label: string }) {
  return (
    <div className="c4 c4--loading">
      <div className="c4__journal">
        <p className="c4-loading__label" role="status">{label}</p>
        <div className="c4-loading__lead" aria-hidden="true">
          <span className="c4-loading__disc is-lead" />
          <span className="c4-loading__lines"><span className="is-title" /><span /><span className="is-short" /></span>
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="c4-loading__row" aria-hidden="true">
            <span className="c4-loading__day" />
            <span className="c4-loading__disc" />
            <span className="c4-loading__lines"><span /><span className="is-short" /></span>
          </div>
        ))}
      </div>
      <div className="c4__side" aria-hidden="true">
        <div className="c4-loading__index">
          {ACHIEVEMENT_GROUPS.map((group) => (
            <span key={group} className="c4-loading__group"><span /><span /><span /><span /></span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Insights › Achievements as a journal: the latest first, the days before it, then what is still ahead; the index and the detail beside it. */
export function C4Tab({ model }: AchievementLayoutTabProps) {
  const { effectiveLanguage: language, t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;
  const aheadNode = useRef<HTMLElement>(null);

  if (model.loading) return <C4Loading label={t("achievements.loading")} />;

  const entries = journalEntries(items);
  const ahead = aheadEntries(items);
  const [lead, ...earlier] = entries;
  const showRarity = items.some((item) => shownRarity(item) !== null);
  const context: RowContext = { t, language, selectedId: selected?.definition.id, showRarity, choose: model.choose };

  const months: { key: string; label: string; items: AchievementItem[] }[] = [];
  for (const item of earlier) {
    const day = entryDay(item);
    const key = day.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) last.items.push(item);
    else months.push({ key, label: journalMonth(day, language), items: [item] });
  }

  const jumpAhead = () => {
    aheadNode.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  let order = 1;
  return (
    <div className="c4" data-rarity={showRarity ? "shown" : "none"}>
      <div className="c4__journal" aria-label={t("achievements.c4.journal")} role="region">
        {status === "error" && !failedEmpty ? (
          <p className="c4-notice" role="alert">
            <span>{t("achievements.error")}</span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </p>
        ) : null}

        {failedEmpty ? (
          <div className="c4-error" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
          </div>
        ) : lead ? (
          <LeadEntry item={lead} context={context} isNew={isNew(lead)} aheadCount={ahead.length} onOpenDay={onOpenDay} onJump={jumpAhead} />
        ) : (
          <p className="c4-empty c4-rise" style={rise(0)}>{t("achievements.c4.empty")}</p>
        )}

        {months.map((month) => (
          <section key={month.key} className="c4-section" aria-labelledby={"c4-month-" + month.key}>
            <h2 id={"c4-month-" + month.key} className="c4-section__title">{month.label}</h2>
            <ol className="c4-rows">
              {month.items.map((item) => (
                <EarnedRow key={item.definition.id} item={item} context={context} isNew={isNew(item)} index={order++} onOpenDay={onOpenDay} />
              ))}
            </ol>
          </section>
        ))}

        {ahead.length > 0 ? (
          <section ref={aheadNode} className="c4-section c4-section--ahead" aria-labelledby="c4-ahead-title">
            <div className="c4-section__head">
              <h2 id="c4-ahead-title" className="c4-section__title">{t("achievements.c4.ahead.title")}</h2>
              {!lead && showRarity ? <span className="c4-rarity__caption">{t("achievements.c4.rarityColumn")}</span> : null}
            </div>
            <ol className="c4-rows">
              {ahead.map((item) => <AheadRow key={item.definition.id} item={item} context={context} index={order++} />)}
            </ol>
          </section>
        ) : null}

        <p className="c4-footnote" role={status === "loading" ? "status" : undefined}>
          {status === "loading" ? t("achievements.loading") : t("achievements.note")}
        </p>
      </div>

      <div className="c4__side">
        {selected ? <C4Detail item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} /> : null}

        <section className="c4-index" aria-labelledby="c4-index-title">
          <div className="c4-index__head">
            <p id="c4-index-title" className="c4-index__title">{t("achievements.c4.index.title")}</p>
            <p className="c4-index__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
          </div>
          {byGroup.map(({ group, items: groupItems }) => (
            <section key={group} className="c4-index__group" aria-labelledby={"c4-group-" + group}>
              <div className="c4-index__label">
                <h2 id={"c4-group-" + group} className="c4-index__group-title">{t(("achievements.group." + group) as TranslationKey)}</h2>
                <span className="c4-index__group-count">{groupItems.filter((item) => item.earned).length}/{groupItems.length}</span>
              </div>
              <div className="c4-index__tiles">
                {groupItems.map((item) => {
                  const name = achievementName(item, t);
                  const src = medalSource(item, true);
                  return (
                    <button
                      key={item.definition.id}
                      type="button"
                      className="c4-tile"
                      data-state={item.earned ? "earned" : "locked"}
                      aria-pressed={item.definition.id === selected?.definition.id}
                      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
                      title={name}
                      onClick={() => model.choose(item.definition.id)}
                    >
                      {src ? <img className="c4-medal-img" src={src} alt="" draggable={false} /> : null}
                      {isNew(item) ? <span className="c4-tile__new" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}
