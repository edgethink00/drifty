import type { CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementGroup } from "../../achievementCatalog";
import { AchievementMedal } from "../../AchievementMedal";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay, medalName, timesLabel } from "../../achievementCopy";
import { progressShare, progressText, remainingText } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutTabProps } from "../types";
import { C3Page } from "./C3Page";
import "./c3-tab.css";

type IsNew = (item: AchievementItem) => boolean;

/** The medal a folded chapter opens on: a new one, else the latest earned, else its first. */
function chapterLead(items: readonly AchievementItem[], isNew: IsNew): AchievementItem | undefined {
  const latest = items
    .filter((item) => item.earned)
    .sort((left, right) => (right.earned?.lastDay ?? "").localeCompare(left.earned?.lastDay ?? ""))[0];
  return items.find(isNew) ?? latest ?? items[0];
}

function ChevronIcon() {
  return (
    <svg className="c3-chapter__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function SlotStatus({ item, isNew, t, language }: { readonly item: AchievementItem; readonly isNew: boolean; readonly t: Translate; readonly language: DisplayLanguage }) {
  const { earned, definition } = item;
  if (earned) {
    const day = formatAchievementDay(achievementDay(item) ?? earned.firstDay, language);
    const repeated = definition.repeatable && earned.count > 1;
    return (
      <span className="c3-slot__meta">
        {isNew ? <span className="c3-dot" aria-hidden="true" /> : null}
        <span>{repeated ? timesLabel(earned.count, t) : medalName(item, t)}</span>
        <span className="c3-slot__meta-quiet">{day}</span>
      </span>
    );
  }
  const progress = progressText(item, t, language);
  if (!progress) return null;
  return (
    <span className="c3-slot__progress">
      <span className="c3-bar" aria-hidden="true"><span style={{ width: Math.round(progressShare(item) * 100) + "%" }} /></span>
      <span>{remainingText(item, t, language)}</span>
    </span>
  );
}

type ChapterProps = {
  readonly group: AchievementGroup;
  readonly items: readonly AchievementItem[];
  readonly open: boolean;
  readonly selectedId: string | undefined;
  readonly isNew: IsNew;
  readonly choose: (item: AchievementItem) => void;
};

function Chapter({ group, items, open, selectedId, isNew, choose }: ChapterProps) {
  const { effectiveLanguage, t } = useLocalization();
  const groupName = t(("achievements.group." + group) as TranslationKey);
  const earnedCount = items.filter((item) => item.earned).length;
  const headingId = "c3-chapter-" + group;
  const tilesId = headingId + "-medals";
  const lead = chapterLead(items, isNew);
  const intro = t(("achievements.c3.intro." + group) as TranslationKey);

  return (
    <section className="c3-chapter" data-open={open ? "true" : "false"} aria-labelledby={headingId}>
      <div className="c3-chapter__head">
        <h2 id={headingId} className="c3-chapter__title">
          {open ? groupName : (
            <button
              type="button"
              className="c3-chapter__toggle"
              aria-expanded="false"
              aria-controls={tilesId}
              onClick={() => { if (lead) choose(lead); }}
            >
              {groupName}
            </button>
          )}
        </h2>
        <span className="c3-chapter__count">
          {earnedCount}/{items.length}
          {!open && items.some(isNew) ? <span className="c3-dot" aria-hidden="true" /> : null}
        </span>
        {open ? null : (
          <span className="c3-bar c3-chapter__meter" aria-hidden="true">
            <span style={{ width: Math.round((earnedCount / Math.max(1, items.length)) * 100) + "%" }} />
          </span>
        )}
        {open ? <p className="c3-chapter__intro">{intro}</p> : null}
      </div>
      <div
        id={tilesId}
        className="c3-chapter__tiles"
        role="group"
        aria-label={t("achievements.c3.chapterCount", { group: groupName, earned: earnedCount, total: items.length })}
      >
        {items.map((item, index) => {
          const name = achievementName(item, t);
          return (
            <button
              key={item.definition.id}
              type="button"
              className="c3-slot"
              data-state={item.earned ? "earned" : "locked"}
              style={{ "--c3-i": index } as CSSProperties}
              title={open ? undefined : name}
              aria-pressed={item.definition.id === selectedId}
              aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name })}
              onClick={() => choose(item)}
            >
              <AchievementMedal item={item} />
              {open ? (
                <span className="c3-slot__text" aria-hidden="true">
                  <span className="c3-slot__name">{name}</span>
                  <span className="c3-slot__condition">{achievementCondition(item, t)}</span>
                  <SlotStatus item={item} isNew={isNew(item)} t={t} language={effectiveLanguage} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {open ? null : <p className="c3-chapter__aside">{intro}</p>}
      {open ? null : <ChevronIcon />}
    </section>
  );
}

function C3Loading({ label }: { readonly label: string }) {
  return (
    <div className="c3-book">
      <div className="c3-index">
        <div className="c3-index__head"><p className="c3-loading__label" role="status">{label}</p></div>
        {ACHIEVEMENT_GROUPS.map((group, index) => (
          <div key={group} className="c3-loading__row" aria-hidden="true">
            <span />
            {Array.from({ length: index === 0 ? 4 : 3 }, (_, medal) => <span key={medal} />)}
          </div>
        ))}
      </div>
      <div className="c3-page" aria-hidden="true">
        <span className="c3-loading__medal" />
        <span className="c3-loading__line is-title" />
        <span className="c3-loading__line" />
      </div>
    </div>
  );
}

/** Insights › Achievements as a book: the chapters on the left, the chosen medal's page on the right. */
export function C3Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, items, byGroup, earnedCount, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;

  if (model.loading) return <C3Loading label={t("achievements.loading")} />;

  if (failedEmpty) {
    return (
      <div className="c3-error" role="alert">
        <p>{t("achievements.error")}</p>
        <button type="button" className="app-btn app-btn--secondary" onClick={onRetry}>{t("achievements.retry")}</button>
      </div>
    );
  }

  const openGroup = selected?.definition.group ?? byGroup[0]?.group;
  const choose = (item: AchievementItem) => model.choose(item.definition.id);

  return (
    <div className="c3-book">
      <div className="c3-index">
        <div className="c3-index__head">
          <div className="c3-total">
            <p className="c3-total__figure" aria-hidden="true"><strong>{earnedCount}</strong><span>/{items.length}</span></p>
            <div className="c3-total__body">
              <p className="c3-index__count">{t("achievements.summary", { earned: earnedCount, total: items.length })}</p>
              <span className="c3-total__bar" aria-hidden="true">
                {byGroup.map(({ group, items: groupItems }) => (
                  <span key={group} className="c3-total__part" style={{ flexGrow: groupItems.length }}>
                    <span style={{ width: Math.round((groupItems.filter((item) => item.earned).length / Math.max(1, groupItems.length)) * 100) + "%" }} />
                  </span>
                ))}
              </span>
            </div>
          </div>
          {status === "error" ? (
            <p className="c3-index__notice" role="alert">
              <span>{t("achievements.error")}</span>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
            </p>
          ) : null}
        </div>
        {byGroup.map(({ group, items: groupItems }) => (
          <Chapter
            key={group}
            group={group}
            items={groupItems}
            open={group === openGroup}
            selectedId={selected?.definition.id}
            isNew={isNew}
            choose={choose}
          />
        ))}
        <p className="c3-index__note" role={status === "loading" ? "status" : undefined}>
          {status === "loading" ? t("achievements.loading") : t("achievements.note")}
        </p>
      </div>
      {selected ? <C3Page item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} /> : null}
    </div>
  );
}
