import { Fragment, useEffect, useId, useRef } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { GOLD_FROM_COUNT, RING_FROM_COUNT, achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  rarityReadsAsFew,
  shownRarity,
  timesLabel,
} from "../../achievementCopy";
import { achievementMilestoneProgress } from "../../achievementMilestones";
import { nextMedal, progressShare, progressText, remainingText } from "../../achievementProgress";
import { formatRarityBasis } from "../../achievementRarity";
import type { AchievementItem } from "../../useAchievements";
import { rarityLine, recordSentence, tileStatus } from "./c6Copy";
import { C6Medal } from "./C6Medal";

const TRACK: readonly { readonly stage: AchievementBadgeStage; readonly from: number; readonly label: TranslationKey }[] = [
  { stage: "silver", from: 1, label: "achievements.medal.silver" },
  { stage: "gold", from: GOLD_FROM_COUNT, label: "achievements.medal.gold" },
  { stage: "ring", from: RING_FROM_COUNT, label: "achievements.medal.ringShort" },
];

function Chevron({ up }: { readonly up: boolean }) {
  return (
    <svg className="c6-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}

function MedalTrack({ item, count, t }: { readonly item: AchievementItem; readonly count: number; readonly t: Translate }) {
  const current = achievementBadgeStage(item);
  return (
    <div className="c6-track">
      {TRACK.map((step, index) => {
        const previous = TRACK[index - 1];
        const share = previous ? Math.max(0, Math.min(1, (count - previous.from) / (step.from - previous.from))) : 0;
        const isCurrent = step.stage === current;
        const src = achievementBadgeUrl(item.definition.id, step.stage, true);
        return (
          <Fragment key={step.stage}>
            {previous ? <span className="c6-track__line" aria-hidden="true"><span style={{ transform: "scaleX(" + share + ")" }} /></span> : null}
            <span className="c6-track__stop" data-current={isCurrent ? "true" : undefined} aria-current={isCurrent ? "step" : undefined}>
              {src ? <img className="c6-track__medal" src={src} alt="" draggable={false} /> : null}
              <span className="c6-track__text">
                <span className="c6-track__name">{t(step.label)}</span>
                <span className="c6-track__note">{isCurrent ? t("achievements.medal.now", { count }) : t("achievements.medal.from", { count: step.from })}</span>
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Everything about one achievement: what it asks, its medal, its record and how rare it is. */
function SheetFacts({ item, onOpenDay }: { readonly item: AchievementItem; readonly onOpenDay: (day: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const { definition, earned } = item;
  const rarity = shownRarity(item);
  const next = nextMedal(item);
  const milestone = earned && definition.repeatable ? achievementMilestoneProgress(earned.count) : null;
  const progress = earned ? null : progressText(item, t, effectiveLanguage);
  if (definition.hidden && !earned) return null;
  if (!earned && !progress && !rarity) return null;

  return (
    <dl className="c6-facts">
      {earned ? (
        <div className="c6-facts__row">
          <dt>{t("achievements.medal.title")}</dt>
          <dd>
            {definition.repeatable ? (
              <>
                <MedalTrack item={item} count={earned.count} t={t} />
                <span className="c6-facts__quiet">
                  {next ? t(next.key, { remaining: next.remaining }) : t("achievements.medal.top")}
                  {milestone && !next ? " · " + t("achievements.milestone.next", { target: milestone.target }) : null}
                </span>
              </>
            ) : (
              <span className="c6-facts__value">
                <strong>{medalName(item, t)}</strong>
                <span className="c6-facts__quiet">{t("achievements.medal.once")}</span>
              </span>
            )}
          </dd>
        </div>
      ) : null}

      {earned ? (
        <div className="c6-facts__row">
          <dt>{t("achievements.record.title")}</dt>
          <dd className="c6-facts__record">
            <span className="c6-stats">
              {definition.repeatable && earned.count > 1 ? (
                <>
                  <span className="c6-stats__item"><span>{t("achievements.stat.first")}</span><strong>{formatAchievementDay(earned.firstDay, effectiveLanguage)}</strong></span>
                  <span className="c6-stats__item"><span>{t("achievements.stat.last")}</span><strong>{formatAchievementDay(earned.lastDay, effectiveLanguage)}</strong></span>
                  <span className="c6-stats__item"><span>{t("achievements.stat.count")}</span><strong>{timesLabel(earned.count, t)}</strong></span>
                </>
              ) : (
                <span className="c6-stats__item"><span>{t("achievements.stat.earnedOn")}</span><strong>{formatAchievementDay(achievementDay(item) ?? earned.firstDay, effectiveLanguage)}</strong></span>
              )}
            </span>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact c6-facts__day" onClick={() => onOpenDay(achievementDay(item) ?? earned.firstDay)}>
              {t("achievements.openDay")}
            </button>
          </dd>
        </div>
      ) : progress ? (
        <div className="c6-facts__row">
          <dt>{t("achievements.progress")}</dt>
          <dd className="c6-progress">
            <span className="c6-progress__bar" aria-hidden="true"><span style={{ transform: "scaleX(" + progressShare(item) + ")" }} /></span>
            <span className="c6-progress__text">{progress}</span>
            <strong className="c6-progress__left">{remainingText(item, t, effectiveLanguage)}</strong>
          </dd>
        </div>
      ) : null}

      {rarity ? (
        <div className="c6-facts__row">
          <dt>{t("achievements.rarity.title")}</dt>
          <dd className="c6-rarity">
            <RarityText item={item} />
            <span className="c6-rarity__note">
              {rarityReadsAsFew(rarity)
                ? t("achievements.rarity.basisShort")
                : t("achievements.rarity.basis", { count: formatRarityBasis(rarity.basisCount, effectiveLanguage) })}
            </span>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function RarityText({ item, stacked = false }: { readonly item: AchievementItem; readonly stacked?: boolean }) {
  const { effectiveLanguage, t } = useLocalization();
  const line = rarityLine(item, t, effectiveLanguage, "tab");
  if (!line) return null;
  if (stacked) {
    return (
      <span className="c6-rarity__stack">
        <span className="c6-rarity__tier" data-notable={line.notable ? "true" : undefined}>{line.tier}</span>
        <span className="c6-rarity__line">{line.sentence}</span>
      </span>
    );
  }
  return (
    <span className="c6-rarity__line">
      {line.sentence}
      <span className="c6-rarity__sep" aria-hidden="true"> · </span>
      <span className="c6-rarity__tier" data-notable={line.notable ? "true" : undefined}>{line.tier}</span>
    </span>
  );
}

/** The collapsed bar's right side: rarity first, else the record, else how far along. */
function BarStatus({ item }: { readonly item: AchievementItem }) {
  const { effectiveLanguage, t } = useLocalization();
  if (shownRarity(item)) return <span className="c6-bar__status"><RarityText item={item} stacked /></span>;
  const record = recordSentence(item, t, effectiveLanguage);
  if (record) return <span className="c6-bar__status"><span className="c6-bar__record">{record}</span></span>;
  const status = tileStatus(item, t, effectiveLanguage);
  if (status.kind === "progress") {
    return (
      <span className="c6-bar__status">
        <span className="c6-progress__bar c6-progress__bar--short" aria-hidden="true"><span style={{ transform: "scaleX(" + status.share + ")" }} /></span>
        <span className="c6-bar__record">{status.text}</span>
      </span>
    );
  }
  return null;
}

type C6DrawerProps = {
  readonly item: AchievementItem;
  readonly isNew: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenDay: (day: string) => void;
};

function setInert(node: HTMLElement | null, inert: boolean) {
  if (!node) return;
  if (inert) node.setAttribute("inert", "");
  else node.removeAttribute("inert");
}

/**
 * The aside at the bottom of the tab. Collapsed it is a bar with the chosen
 * medal, its name and one line; open it is a sheet over the gallery with
 * everything about it. Both faces are drawn up front and the hidden one is
 * inert, so the open sheet only rises and fades in.
 */
export function C6Drawer({ item, isNew, open, onOpenChange, onOpenDay }: C6DrawerProps) {
  const { t } = useLocalization();
  const sheetId = useId();
  const bar = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const lessButton = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const { definition, earned } = item;
  const name = achievementName(item, t);
  const condition = achievementCondition(item, t);
  const context = [t(("achievements.group." + definition.group) as TranslationKey)];
  if (earned && definition.hidden) context.push(t("achievements.hiddenFound"));
  if (!earned && !definition.hidden) context.push(t("achievements.notEarned"));

  useEffect(() => {
    setInert(bar.current, open);
    setInert(sheet.current, !open);
    if (open && focusOnOpen.current) lessButton.current?.focus();
    focusOnOpen.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const inside = sheet.current?.contains(document.activeElement) ?? false;
      onOpenChange(false);
      if (inside) moreButton.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  function openFromButton() {
    focusOnOpen.current = true;
    onOpenChange(true);
  }

  function close() {
    onOpenChange(false);
    moreButton.current?.focus();
  }

  return (
    <aside className="c6-drawer" data-open={open ? "true" : "false"} aria-label={t("achievements.c6.drawer")}>
      <div ref={bar} className="c6-bar" aria-hidden={open ? "true" : undefined}>
        <span className="c6-bar__medal" key={definition.id}>
          <C6Medal item={item} small />
        </span>
        <div className="c6-bar__text">
          <h3 className="c6-bar__name">{name}</h3>
          <p className="c6-bar__sub">
            {isNew ? <span className="c6-new"><span className="c6-dot" aria-hidden="true" />{t("achievements.newArrival")}<span aria-hidden="true"> · </span></span> : null}
            {condition}
          </p>
        </div>
        <BarStatus item={item} />
        <button
          ref={moreButton}
          type="button"
          className="app-btn app-btn--secondary app-btn--compact c6-bar__more"
          aria-expanded={open}
          aria-controls={sheetId}
          onClick={openFromButton}
        >
          {t("achievements.c6.more")}
          <Chevron up />
        </button>
      </div>

      <div ref={sheet} id={sheetId} className="c6-sheet" aria-hidden={open ? undefined : "true"}>
        <div className="c6-sheet__medal" key={"medal-" + definition.id}>
          <C6Medal item={item} floor={earned !== null} />
        </div>
        <div className="c6-sheet__story" key={"story-" + definition.id}>
          <div className="c6-sheet__head">
            <div className="c6-sheet__title">
              <p className="c6-sheet__context">
                {context.join(" · ")}
                {isNew ? <><span aria-hidden="true"> · </span><span className="c6-new"><span className="c6-dot" aria-hidden="true" />{t("achievements.newArrival")}</span></> : null}
              </p>
              <h3 className="c6-sheet__name">{name}</h3>
              <p className="c6-sheet__condition">{condition}</p>
            </div>
            <button ref={lessButton} type="button" className="app-btn app-btn--quiet app-btn--compact c6-sheet__less" aria-expanded={open} aria-controls={sheetId} onClick={close}>
              {t("achievements.c6.less")}
              <Chevron up={false} />
            </button>
          </div>
          <SheetFacts item={item} onOpenDay={onOpenDay} />
        </div>
      </div>
    </aside>
  );
}
