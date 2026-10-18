import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { ModalPresence } from "../../components/ModalPresence";
import { formatLocalizedDuration, localeForDisplayLanguage } from "../../lib/formatting";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { formatPreciseTopPercentile, getPreciseTopPercentile } from "./leaderboardStanding";
import "./leaderboard-screen.css";

/**
 * The leaderboard screen. A header with the window and the period switch;
 * a top row with the member's profile card and the Top 3; the ranked list
 * from #4 below it. The top row keeps one height in every state (joined,
 * not joined, not ranked yet) so joining or leaving never moves the list.
 */

export type LeaderboardProfileLink = { readonly key: string; readonly href: string; readonly label: string };

export type LeaderboardScreenProps = {
  readonly activePeriod: LeaderboardPeriod;
  readonly rows: readonly LeaderboardRow[];
  readonly isLoading: boolean;
  readonly isOptedIn: boolean;
  readonly isParticipationResolved: boolean;
  readonly isActionLoading: boolean;
  readonly isCatchingUp: boolean;
  readonly actionError: string | null;
  readonly ownRank: number | null;
  readonly ownFocusSeconds: number | null;
  readonly participantCount: number | null;
  readonly totalFocusSeconds: number;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string;
  readonly links: readonly LeaderboardProfileLink[];
  /** Null while the local 30-day series is loading or unavailable. */
  readonly weekFocusSeconds: number | null;
  readonly weekDeltaPercent: number | null;
  readonly streakDays: number;
  readonly last30Seconds: number | null;
  readonly weekPoints: readonly DailyProductivityPoint[];
  /** One line beside the period switch: board refresh, profile save, validation or local-total status. */
  readonly statusMessage: string | null;
  readonly statusTone: "error" | "neutral";
  readonly shareState: "hidden" | "enabled" | "disabled";
  readonly onShare: () => void;
  readonly onEmbed: () => void;
  readonly onEditProfile: (() => void) | null;
  /** Joins, or signs in first when signed out. */
  readonly onJoin: (() => void) | null;
  readonly onLeave: (() => void) | null;
  readonly onPeriodChange?: (period: LeaderboardPeriod) => void;
  readonly onSelectProfile?: (row: LeaderboardRow) => void;
};

const PODIUM_KEYS = { daily: "leaderboard.v2.podiumDaily", weekly: "leaderboard.v2.podiumWeekly", monthly: "leaderboard.v2.podiumMonthly" } satisfies Record<LeaderboardPeriod, TranslationKey>;
const PERIOD_LABELS = { daily: "leaderboard.daily", weekly: "leaderboard.weekly", monthly: "leaderboard.monthly" } satisfies Record<LeaderboardPeriod, TranslationKey>;
const TIERS = ["gold", "silver", "bronze"] as const;
const ORDINALS = ["1st", "2nd", "3rd"] as const;
/** Below the top half, or on a small board, the rank leads instead of a percentage. */
const SMALL_BOARD = 10;

type Hint = { readonly kind: "lead" | "chase" | "tied"; readonly seconds: number; readonly rank: number };

type Board = {
  readonly podium: readonly (LeaderboardRow | null)[];
  readonly rest: readonly LeaderboardRow[];
  readonly leaderFocus: number | null;
  readonly leaderMargin: number | null;
  readonly ownRank: number | null;
  readonly ownFocus: number | null;
  readonly ownOutside: boolean;
  readonly lastRank: number;
  readonly count: number | null;
  readonly topPercent: number | null;
  readonly rankLeads: boolean;
  readonly hint: Hint | null;
};

function buildBoard(props: LeaderboardScreenProps): Board {
  const byRank = new Map(props.rows.map((row) => [row.rank, row] as const));
  const podium = [1, 2, 3].map((rank) => byRank.get(rank) ?? null);
  const ownRank = props.isOptedIn ? props.ownRank : null;
  const ownRow = ownRank === null ? null : byRank.get(ownRank) ?? null;
  const lastRank = props.rows.length > 0 ? props.rows[props.rows.length - 1].rank : 0;
  const ownFocus = ownRank === null ? null : props.ownFocusSeconds ?? ownRow?.focus_seconds ?? null;
  let hint: Hint | null = null;
  if (ownRank !== null && ownFocus !== null) {
    if (ownRank === 1) {
      const second = podium[1];
      if (second) hint = ownFocus > second.focus_seconds ? { kind: "lead", seconds: ownFocus - second.focus_seconds, rank: 2 } : { kind: "tied", seconds: 0, rank: 2 };
    } else {
      const rival = byRank.get(ownRank - 1);
      if (rival) hint = rival.focus_seconds > ownFocus ? { kind: "chase", seconds: Math.max(60, Math.ceil((rival.focus_seconds - ownFocus) / 60) * 60), rank: rival.rank } : { kind: "tied", seconds: 0, rank: rival.rank };
    }
  }
  const topPercent = ownRank === null ? null : getPreciseTopPercentile(ownRank, props.participantCount);
  const leader = podium[0];
  return {
    podium,
    rest: props.rows.filter((row) => row.rank > 3),
    leaderFocus: leader ? leader.focus_seconds : null,
    leaderMargin: leader && podium[1] ? Math.max(0, leader.focus_seconds - podium[1].focus_seconds) : null,
    ownRank,
    ownFocus,
    ownOutside: ownRank !== null && ownRow === null && ownRank > lastRank,
    lastRank,
    count: props.participantCount,
    topPercent,
    rankLeads: (props.participantCount ?? 0) < SMALL_BOARD || topPercent === null || topPercent > 50,
    hint,
  };
}

type Ctx = LeaderboardScreenProps & {
  readonly board: Board;
  /** Opens the leave confirmation; Leave in the menu never acts directly. */
  readonly requestLeave: (() => void) | null;
  readonly leaveOpen: boolean;
};

export function LeaderboardScreen(props: LeaderboardScreenProps) {
  const board = useMemo(() => buildBoard(props), [props]);
  const list = useListJump();
  const canFindMe = board.ownRank !== null && board.ownRank > 3 && !props.isLoading;
  const findMe = canFindMe ? () => { if (board.ownRank !== null) list.jumpTo(board.ownRank); } : null;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const wasOptedIn = useRef(props.isOptedIn);
  /** Returns focus to a control in the board once the dialog has gone. */
  const refocus = useCallback((selector: string) => {
    window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus());
  }, []);
  useEffect(() => {
    if (wasOptedIn.current && !props.isOptedIn && props.isParticipationResolved) {
      setLeaveOpen(false);
      refocus(".lb7-profile .app-btn--primary");
    }
    if (!wasOptedIn.current && props.isOptedIn && props.isParticipationResolved) refocus(".lb7-share");
    wasOptedIn.current = props.isOptedIn;
  }, [props.isOptedIn, props.isParticipationResolved, refocus]);
  const ctx: Ctx = { ...props, board, requestLeave: props.onLeave ? () => setLeaveOpen(true) : null, leaveOpen };
  return (
    <div ref={rootRef} className="lb7">
      <Header {...ctx} />
      <div className="lb7-top">
        <ProfileCard {...ctx} />
        <HallOfFame {...ctx} />
      </div>
      <Rankings {...ctx} list={list} onFindMe={findMe} />
      <ModalPresence>{leaveOpen ? <LeaveDialog {...ctx} onCancel={() => { setLeaveOpen(false); refocus(".lb7-menu-anchor > button"); }} /> : null}</ModalPresence>
    </div>
  );
}

/* ---------- Header ---------- */

function Header({ rows, activePeriod, isLoading, onPeriodChange, totalFocusSeconds, board, statusMessage, statusTone }: Ctx) {
  const { effectiveLanguage, t } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const meta = [windowLabel(rows, activePeriod, locale)];
  if (board.count !== null && !isLoading) meta.push(t("leaderboard.v2.meta", { count: board.count.toLocaleString(locale), total: formatLocalizedDuration(totalFocusSeconds, effectiveLanguage) }));
  return (
    <header className="pg-head lb7-head">
      <div className="lb7-head__lead">
        <h1>{t("leaderboard.title")}</h1>
        <p>{meta.join(" · ")}</p>
      </div>
      <div className="lb7-head__side">
        {statusMessage ? <span className="lb7-head__status" data-tone={statusTone} role="status">{statusMessage}</span> : null}
        <div className="seg" role="group" aria-label={t("leaderboard.periodAria")}>
          {(["daily", "weekly", "monthly"] as const).map((period) => (
            <button key={period} type="button" className={activePeriod === period ? "on" : undefined} aria-pressed={activePeriod === period} disabled={isLoading} onClick={() => onPeriodChange?.(period)}>
              {t(PERIOD_LABELS[period])}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ---------- Profile card ---------- */

function ProfileCard(props: Ctx) {
  const { t } = useLocalization();
  const ranked = props.isParticipationResolved && !props.isLoading && props.isOptedIn && props.board.ownRank !== null;
  if (ranked) return <RankedProfile {...props} />;
  return (
    <section className={"lb7-card lb7-profile" + (props.isOptedIn ? " lb7-pv--p8" : "")} aria-label={t("leaderboard.v2.yourProfile")}>
      <Identity {...props} size={36} />
      <Standing {...props} />
      {props.actionError && !props.isLoading && !props.leaveOpen ? <p className="lb7-error" role="alert">{props.actionError}</p> : null}
    </section>
  );
}

/** Everything under the name before the member has a rank: a loading frame, the join card, or "Not ranked yet". */
function Standing(props: Ctx) {
  const { t } = useLocalization();
  if (!props.isParticipationResolved || props.isLoading) {
    // While the session restores, say what is happening instead of asserting "not joined".
    const checking = !props.isParticipationResolved;
    return (
      <div className="lb7-standing" role={checking ? "status" : undefined} aria-label={checking ? t("leaderboard.checkingParticipationAria") : undefined} aria-hidden={checking ? undefined : true}>
        <span className="lb7-bone lb7-bone--big" aria-hidden="true" /><span className="lb7-bone" aria-hidden="true" />
      </div>
    );
  }
  if (!props.isOptedIn) return <JoinCard {...props} />;
  return (
    <>
      <div className="lb7-pv8__stand lb7-pv8__stand--pending">
        <p className="lb7-value lb7-value--muted">{t("leaderboard.notRanked")}</p>
      </div>
      <p className="lb7-pv8__pendhint">{t("leaderboard.v2.rankPending")}</p>
      <WeekBox {...props} />
    </>
  );
}

/** The ranked card: Top % (or the rank on a small board) with the next-rank goal, the position bar ending in the rank, and the week box. */
function RankedProfile(props: Ctx) {
  const { effectiveLanguage, t } = useLocalization();
  const { board } = props;
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const dur = (seconds: number) => formatLocalizedDuration(seconds, effectiveLanguage);
  const rank = board.ownRank ?? 0;
  const count = board.count ?? 0;
  const countText = count.toLocaleString(locale);
  const at = count > 1 ? Math.min(100, Math.max(0, ((rank - 1) / (count - 1)) * 100)) : 0;
  // Without a trustworthy participant count there is no "of N" to show; the rank stands alone.
  const rankText = board.count === null ? null : board.rankLeads ? t("leaderboard.v2.ofCount", { count: countText }) : t("leaderboard.v2.rankOfCount", { rank, count: countText });
  return (
    <section className="lb7-card lb7-profile lb7-pv lb7-pv--p8" aria-label={t("leaderboard.v2.yourProfile")}>
      <Identity {...props} size={36} />
      <div className="lb7-pv8__stand lb7-pv8__stand--x6">
        <span className="lb7-pv8__lead">
          {board.rankLeads ? <p className="lb7-value"><b>#{rank}</b></p> : <p className="lb7-value"><TopPercent text={t("leaderboard.v2.topPercent", { percent: "\u0000" })} percent={formatPreciseTopPercentile(board.topPercent ?? 0)} /></p>}
        </span>
        <span className="lb7-pv8__side">
          <NextHint {...props} dur={dur} />
          {/* The rank closes the position bar; with no bar (a single participant) it stays beside the hint. */}
          {count > 1 || rankText === null ? null : <span className="lb7-pv8__rank">{rankText}</span>}
        </span>
      </div>
      {count > 1 ? (
        <div className="lb7-pv8__track">
          <span className="lb7-track" aria-hidden="true"><span className="lb7-track__fill" style={{ width: at + "%" }} /><span className="lb7-track__dot" style={{ left: "clamp(6px, " + at + "%, calc(100% - 6px))" }} /></span>
          <span className="lb7-pv8__rank lb7-pv8__barrank">{rankText}</span>
        </div>
      ) : null}
      <WeekBox {...props} />
      {props.actionError && !props.leaveOpen ? <p className="lb7-error" role="alert">{props.actionError}</p> : null}
    </section>
  );
}

/** Before joining: who is already on the board, then the prompt and Join. Share and the menu stay hidden. */
function JoinCard(props: Ctx) {
  const { effectiveLanguage, t } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const count = props.board.count ?? props.rows.length;
  return (
    <div className="lb7-join__crowd lb7-join__crowd--a3">
      <div className="lb7-join__faces">
        <span className="lb7-join__stack" aria-hidden="true">{props.rows.slice(0, 5).map((row) => <Avatar key={row.rank} name={row.display_name} src={row.avatar_url} size={30} />)}</span>
        <span className="lb7-join__count">{t("leaderboard.v2.joinBoardCount", { count: count.toLocaleString(locale) })}</span>
      </div>
      <div className="lb7-join__row">
        <span className="lb7-join__prompt"><strong>{t("leaderboard.v2.joinPrompt")}</strong><small>{t("leaderboard.privacy")}</small></span>
        <JoinButton {...props} />
      </div>
    </div>
  );
}

/** The next-rank goal beside the Top %: "↑ 24m to #16", or the lead over #2 when the member is #1. */
function NextHint(props: Ctx & { readonly dur: (seconds: number) => string }) {
  const { t } = useLocalization();
  const hint = props.board.hint;
  if (!hint) return null;
  const time = props.dur(hint.seconds);
  const text = hint.kind === "chase"
    ? t("leaderboard.v2.chaseShort", { duration: "\u0000", rank: hint.rank })
    : hint.kind === "lead" ? t("leaderboard.v2.leadShort", { duration: "\u0000" }) : t("leaderboard.v2.tied", { rank: hint.rank });
  const words = hint.kind === "tied" ? <>{text}</> : withBold(text, time);
  const icon = hint.kind === "chase" ? <ArrowUpIcon /> : null;
  return <span className="lb7-next lb7-next--x6" data-kind={hint.kind}>{icon}<span className="lb7-next__text">{words}</span></span>;
}

/** This week: the total and its change, the flame streak, then seven weekday bars at the right edge. */
function WeekBox(props: Ctx) {
  const { effectiveLanguage, t } = useLocalization();
  const week = props.weekFocusSeconds === null ? "—" : formatLocalizedDuration(props.weekFocusSeconds, effectiveLanguage);
  return (
    <div className="lb7-pv8__week lb7-pv8__week--days">
      <span className="lb7-pv8__weekcopy"><span className="lb7-label">{t("leaderboard.v2.thisWeek")}</span><strong>{week}<Delta value={props.weekDeltaPercent} /></strong></span>
      <span />
      {props.streakDays > 0 ? (
        <span className="lb7-pv8__streak" title={t("leaderboard.v2.streakShort", { count: props.streakDays })}>
          <FlameIcon />
          <span className="lb7-streak__full">{t("leaderboard.v2.streakShort", { count: props.streakDays })}</span>
          <span className="lb7-streak__short">{t("leaderboard.streakDays", { count: props.streakDays })}</span>
        </span>
      ) : <span />}
      <WeekDayBars points={props.weekPoints} locale={localeForDisplayLanguage(effectiveLanguage)} />
    </div>
  );
}

/** Seven daily bars with the weekday under each; today is the solid bar. */
function WeekDayBars({ points, locale }: { readonly points: readonly DailyProductivityPoint[]; readonly locale: string }) {
  if (points.length < 2) return <span />;
  const max = Math.max(1, ...points.map((point) => Math.max(0, point.focus)));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return (
    <span className="lb7-wk__bars has-days" aria-hidden="true">
      {points.map((point, index) => (
        <span key={point.day} className={"lb7-wk__day" + (index === points.length - 1 ? " is-today" : "")}>
          <i style={{ height: point.focus > 0 ? Math.max(12, (point.focus / max) * 100) + "%" : "2px" }} />
          <em>{weekday.format(new Date(point.day + "T12:00:00"))}</em>
        </span>
      ))}
    </span>
  );
}

function Delta({ value }: { readonly value: number | null }) {
  if (value === null || value === 0) return null;
  return <small className={"lb7-delta " + (value < 0 ? "is-down" : "is-up")}>{(value < 0 ? "↓" : "↑") + Math.abs(value) + "%"}</small>;
}

function Identity(props: Ctx & { readonly size: number }) {
  return (
    <div className="lb7-id">
      <Avatar name={props.displayName} src={props.avatarUrl} size={props.size} />
      <div className="lb7-id__text">
        <div className="lb7-id__name">
          <strong title={props.displayName}>{props.displayName}</strong>
          <EditButton {...props} />
        </div>
        <div className="lb7-id__about">
          <Bio {...props} />
          <ProfileLinks links={props.links} />
        </div>
      </div>
      <ProfileActions {...props} />
    </div>
  );
}

function EditButton(props: Ctx) {
  const { t } = useLocalization();
  if (!props.onEditProfile) return null;
  return <button type="button" className="lb7-iconbtn lb7-iconbtn--small" aria-label={t("leaderboard.v2.editProfile")} title={t("leaderboard.v2.editProfile")} onClick={props.onEditProfile}><PencilIcon /></button>;
}

function Bio(props: Ctx) {
  const { t } = useLocalization();
  const bio = props.bio.trim();
  if (bio) return <span className="lb7-id__bio" title={bio}>{bio}</span>;
  return props.onEditProfile ? <button type="button" className="lb7-addbio" onClick={props.onEditProfile}>{t("leaderboard.v2.addBio")}</button> : null;
}

function ProfileLinks({ links }: { readonly links: readonly LeaderboardProfileLink[] }) {
  return (
    <>
      {links.map((link) => (
        <a key={link.key} href={link.href} target="_blank" rel="noreferrer" title={link.href} aria-label={link.label}>
          {link.key === "github" ? <GitHubIcon /> : link.key === "linkedin" ? <LinkedInIcon /> : <GlobeIcon />}
        </a>
      ))}
    </>
  );
}

/** Before joining there is nothing to share, embed or leave, so the card shows no actions at all. */
function ProfileActions(props: Ctx) {
  if (!props.isOptedIn) return null;
  return <div className="lb7-id__actions"><ShareButton {...props} /><MoreMenu {...props} /></div>;
}

/* ---------- Actions ---------- */

function ShareButton(props: Ctx) {
  const { t } = useLocalization();
  if (!props.isParticipationResolved) return <span className="lb7-bone lb7-bone--button" role="status" aria-label={t("leaderboard.checkingParticipationAria")} />;
  if (!props.isOptedIn || props.shareState === "hidden") return null;
  return (
    <button type="button" className="app-btn app-btn--secondary app-btn--header-action lb7-share" aria-haspopup="dialog" aria-label={t("leaderboard.share")} disabled={props.shareState === "disabled"} title={props.shareState === "disabled" ? t("leaderboard.calculatingThirtyDays") : undefined} onClick={props.onShare}>
      <ShareIcon /><span className="lb7-share__label">{t("leaderboard.share")}</span>
    </button>
  );
}

function JoinButton(props: Ctx) {
  const { t } = useLocalization();
  const className = "app-btn app-btn--primary app-btn--compact";
  if (props.isCatchingUp) return <button type="button" className={className} disabled title={t("leaderboard.catchingUpTitle")}>{t("leaderboard.catchingUp")}</button>;
  return (
    <button type="button" className={className} title={t("leaderboard.joinTitle")} disabled={props.isActionLoading || props.isLoading || !props.onJoin} onClick={() => props.onJoin?.()}>
      <ActionLabel busy={props.isActionLoading} busyLabel={t("leaderboard.joining")}>{t("leaderboard.join")}</ActionLabel>
    </button>
  );
}

function MoreMenu(props: Ctx) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return (
    <div className="lb7-menu-anchor" ref={root}>
      <button type="button" className="lb7-iconbtn" aria-label={t("leaderboard.v2.moreActions")} title={t("leaderboard.v2.moreActions")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><DotsIcon /></button>
      {open ? (
        <div className="lb7-menu" role="menu">
          <button type="button" role="menuitem" title={props.ownRank === null ? t("leaderboard.embedDisabledTitle") : undefined} onClick={run(props.onEmbed)}><EmbedIcon />{t("leaderboard.embed")}</button>
          {props.isOptedIn && props.onLeave ? (
            <>
              <span className="lb7-menu__sep" role="separator" />
              <button type="button" role="menuitem" className="is-danger" disabled={props.isActionLoading || props.isLoading} onClick={run(props.requestLeave ?? props.onLeave)}><LeaveIcon />{t("leaderboard.leave")}</button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Top 3 ---------- */

type HallEntry = { readonly place: number; readonly row: LeaderboardRow | null; readonly self: boolean; readonly gap: string };

function hallEntries(props: Ctx, dur: (seconds: number) => string): HallEntry[] {
  const { board, isLoading } = props;
  return [1, 2, 3].map((place) => {
    const row = isLoading ? null : board.podium[place - 1] ?? null;
    const behind = row && place > 1 && board.leaderFocus !== null ? board.leaderFocus - row.focus_seconds : 0;
    const gap = !row ? "" : place === 1 ? (board.leaderMargin ? "+" + dur(board.leaderMargin) : "") : behind > 0 ? "−" + dur(behind) : "";
    return { place, row, self: row !== null && board.ownRank === place, gap };
  });
}

/** Three tiles, #1 a step wider in soft gold; each opens that member's profile. */
function HallOfFame(props: Ctx) {
  const { effectiveLanguage, t } = useLocalization();
  const dur = (seconds: number) => formatLocalizedDuration(seconds, effectiveLanguage);
  return (
    <section className="lb7-card lb7-hall" aria-label={t(PODIUM_KEYS[props.activePeriod])}>
      <div className="lb7-cardhead">
        <span className="lb7-label">{t("leaderboard.v2.topThree") + " · " + t(PERIOD_LABELS[props.activePeriod])}</span>
      </div>
      <ol className="lb7-hx lb7-sb">
        {hallEntries(props, dur).map((entry) => (
          <li key={entry.place} data-place={entry.place} data-tier={TIERS[entry.place - 1]}>
            <button type="button" className="lb7-sb__tile" disabled={!entry.row} onClick={() => { if (entry.row) props.onSelectProfile?.(entry.row); }} aria-label={entry.row ? t("leaderboard.viewProfileAria", { name: entry.row.display_name }) : undefined}>
              <span className="lb7-sb__top">
                <span className="lb7-sb__rank"><span className="lb7-sb__num">{entry.place}</span><span className="lb7-sb__ord">{ORDINALS[entry.place - 1]}</span><span className="lb7-sb__suf">{ORDINALS[entry.place - 1].slice(1)}</span></span>
                {entry.row ? <Avatar name={entry.row.display_name} src={entry.row.avatar_url} size={entry.place === 1 ? 30 : 26} /> : <span className="lb7-hx__ghost" />}
              </span>
              <strong className="lb7-hx__time">{entry.row ? dur(entry.row.focus_seconds) : "—"}</strong>
              {entry.row
                ? <span className="lb7-hx__name"><strong title={entry.row.display_name}>{entry.row.display_name}</strong>{entry.self ? <YouTag /> : null}</span>
                : <span className="lb7-hx__name"><span className="lb7-soft">{props.isLoading ? "" : t("leaderboard.v2.openSpot")}</span></span>}
              <small className="lb7-hx__gap">{entry.gap}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Rankings ---------- */

function useListJump() {
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const smooth = () => (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  const jumpTo = useCallback((rank: number) => {
    const list = ref.current;
    const row = list?.querySelector<HTMLElement>('[data-rank="' + rank + '"]');
    if (!list || !row) return;
    // A pinned row reports its stuck position; measure where it sits in the flow instead.
    const previous = row.previousElementSibling as HTMLElement | null;
    const natural = getComputedStyle(row).position === "sticky" && previous ? previous.offsetTop + previous.offsetHeight : row.offsetTop;
    if (typeof list.scrollTo === "function") list.scrollTo({ top: Math.max(0, natural - (list.clientHeight - row.offsetHeight) / 2), behavior: smooth() });
    setFlash(null);
    window.requestAnimationFrame(() => setFlash(rank));
  }, []);
  const toTop = useCallback(() => { const list = ref.current; if (list && typeof list.scrollTo === "function") list.scrollTo({ top: 0, behavior: smooth() }); }, []);
  useEffect(() => {
    if (flash === null) return undefined;
    const timer = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flash]);
  return { ref, flash, jumpTo, toTop };
}

type ListJump = ReturnType<typeof useListJump>;
type RowLike = Pick<LeaderboardRow, "rank" | "display_name" | "avatar_url" | "focus_seconds">;
type OwnPos = "above" | "below" | "in" | null;

/** #4 down, scrolling inside the card. While the member's row is off screen a floating Find me brings it back. */
function Rankings(props: Ctx & { readonly list: ListJump; readonly onFindMe: (() => void) | null }) {
  const { effectiveLanguage, t } = useLocalization();
  const { board, list, isLoading, rows } = props;
  const [scrolled, setScrolled] = useState(false);
  const [ownPos, setOwnPos] = useState<OwnPos>(null);
  const ownRank = board.ownRank;
  const listRef = list.ref;
  /** Where the member's row sits in the flow relative to the visible part of the list. */
  const measure = useCallback(() => {
    const element = listRef.current;
    const row = ownRank === null ? null : element?.querySelector<HTMLElement>('[data-rank="' + ownRank + '"]') ?? null;
    if (!element || !row) { setOwnPos(null); return; }
    const previous = row.previousElementSibling as HTMLElement | null;
    const top = previous ? previous.offsetTop + previous.offsetHeight : row.offsetTop;
    const head = 32;
    setOwnPos(top + row.offsetHeight <= element.scrollTop + head ? "above" : top >= element.scrollTop + element.clientHeight - 4 ? "below" : "in");
  }, [listRef, ownRank]);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, rows, isLoading]);
  const dur = (seconds: number) => formatLocalizedDuration(seconds, effectiveLanguage);
  const offScreen = ownPos === "above" || ownPos === "below";
  const renderRow = (row: RowLike, source: LeaderboardRow | null) => {
    const self = board.ownRank === row.rank;
    const ratio = board.leaderFocus ? Math.min(1, row.focus_seconds / board.leaderFocus) : 0;
    const body = (
      <>
        <span className="lb7-row__rank">#{row.rank}</span>
        <span className="lb7-row__who"><Avatar name={row.display_name} src={row.avatar_url} size={24} /><strong title={row.display_name}>{row.display_name}</strong>{self ? <YouTag /> : null}</span>
        <span className="lb7-row__bar" aria-hidden="true"><span style={{ width: Math.round(ratio * 1000) / 10 + "%" }} /></span>
        <span className="lb7-row__time">{dur(row.focus_seconds)}</span>
      </>
    );
    return (
      <li key={row.rank} data-rank={row.rank} className={"lb7-row" + (self ? " is-self" : "") + (list.flash === row.rank ? " is-flash" : "")}>
        {source ? <button type="button" onClick={() => props.onSelectProfile?.(source)} aria-label={t("leaderboard.viewProfileAria", { name: row.display_name })}>{body}</button> : <div>{body}</div>}
      </li>
    );
  };
  const showFindMe = props.onFindMe !== null && offScreen;
  return (
    <section className="lb7-card lb7-ranks lb7-ranks--bare" aria-label={t("leaderboard.globalAria")}>
      <div className="lb7-list lb7-list--free" ref={list.ref} onScroll={(event) => { setScrolled(event.currentTarget.scrollTop > 160); measure(); }}>
        {isLoading ? (
          <ol className="lb7-rows" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <li key={index} className="lb7-row"><div><span className="lb7-bone lb7-bone--short" /><span className="lb7-bone" /><span /><span className="lb7-bone lb7-bone--short" /></div></li>)}</ol>
        ) : rows.length === 0 ? (
          <div className="lb7-empty"><strong>{t("leaderboard.noParticipants")}</strong><span>{t("leaderboard.noParticipantsDetail")}</span></div>
        ) : board.rest.length === 0 && !board.ownOutside ? (
          <div className="lb7-empty"><span>{t("leaderboard.v2.onlyTopThree")}</span></div>
        ) : (
          <>
            <div className="lb7-colhead" aria-hidden="true">
              <span>{t("leaderboard.v2.colRank")}</span>
              <span>{t("leaderboard.v2.colParticipant")}</span>
              <span />
              <span>{t("leaderboard.focusTime")}</span>
            </div>
            <ol className="lb7-rows" aria-label={t("leaderboard.rankingsAria")}>
              {board.rest.map((row) => renderRow(row, row))}
              {board.ownOutside && board.ownRank !== null ? (
                <>
                  <li className="lb7-gap" aria-hidden="true">{t("leaderboard.v2.beyondTop", { count: board.lastRank })}</li>
                  {renderRow({ rank: board.ownRank, display_name: props.displayName, avatar_url: props.avatarUrl ?? "", focus_seconds: board.ownFocus ?? 0 }, null)}
                </>
              ) : null}
            </ol>
          </>
        )}
      </div>
      {scrolled || showFindMe ? (
        <div className="lb7-floatbar">
          {scrolled ? <button type="button" className="lb7-floattop" aria-label={t("leaderboard.v2.backToTop")} title={t("leaderboard.v2.backToTop")} onClick={list.toTop}><ArrowUpIcon /></button> : null}
          {showFindMe ? (
            <button type="button" className="lb7-floatme" onClick={props.onFindMe ?? undefined} aria-label={t("leaderboard.v2.findMeAria", { rank: board.ownRank ?? 0 })}>
              <Avatar name={props.displayName} src={props.avatarUrl} size={22} />
              <span className="lb7-floatme__label">{t("leaderboard.v2.findMeShort")}</span><span className="lb7-floatme__rank">#{board.ownRank}</span>
              <span className="lb7-floatme__name">{props.displayName}</span><span className="lb7-floatme__time">{board.ownFocus === null ? "" : dur(board.ownFocus)}</span>{ownPos === "above" ? <ArrowUpIcon /> : <ArrowDownIcon />}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Leave ---------- */

/** Confirms leaving and states exactly what changes: the board entry and public page go, local tracking stays. */
function LeaveDialog(props: Ctx & { readonly onCancel: () => void }) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const busy = props.isActionLoading;
  useModalDismiss(props.onCancel, { disabled: busy });
  const overlayDismiss = useOverlayDismiss(props.onCancel, { disabled: busy });
  useAnchoredDialog(panelRef);
  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell lb7-leave"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="lb7-leave-title"
        aria-describedby="lb7-leave-detail"
        data-modal-initial-selector="[data-lb7-leave-cancel]"
      >
        <div className="auth-modal__header">
          <h2 id="lb7-leave-title">{t("leaderboard.v2.leaveTitle")}</h2>
          <ul id="lb7-leave-detail" className="lb7-leave__list">
            <li>{t("leaderboard.v2.leaveRank")}</li>
            <li>{t("leaderboard.v2.leaveProfile")}</li>
            <li>{t("leaderboard.v2.leaveLocal")}</li>
            <li>{t("leaderboard.v2.leaveRejoin")}</li>
          </ul>
          {props.actionError && !busy ? <p className="lb7-leave__error" role="alert">{props.actionError}</p> : null}
        </div>
        <div className="lb7-leave__actions">
          <button type="button" className="modal-btn modal-btn--ghost" data-lb7-leave-cancel disabled={busy} onClick={props.onCancel}>
            {t("common.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={busy || !props.onLeave} aria-busy={busy} onClick={() => props.onLeave?.()}>
            <ActionLabel busy={busy} busyLabel={t("leaderboard.leaving")}>{t("leaderboard.leave")}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- Atoms ---------- */

function Avatar({ name, src, size }: { readonly name: string; readonly src?: string | null; readonly size: number }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) };
  const url = src?.trim();
  if (url) return <img className="lb7-avatar" src={url} alt="" aria-hidden="true" style={style} />;
  return <span className="lb7-avatar" aria-hidden="true" style={style}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function YouTag() {
  const { t } = useLocalization();
  return <span className="lb7-you">{t("leaderboard.you")}</span>;
}

/** Puts the duration in bold wherever the sentence places it ("12m more to pass #28", "#28까지 12m"). */
function withBold(sentence: string, duration: string) {
  const [before, ...after] = sentence.split("\u0000");
  return <>{before}<b>{duration}</b>{after.join(duration)}</>;
}

/** "Top 40.8%" / "상위 40.8%": the number is large, the localized words around it stay small. */
function TopPercent({ text, percent }: { readonly text: string; readonly percent: string }) {
  const [before, ...after] = text.split("\u0000");
  return (
    <>
      {before.trim() ? <span className="lb7-value__top">{before.trim()}</span> : null}
      <b>{percent}{after.join("").trim().startsWith("%") ? "%" : ""}</b>
      {after.join("").trim().replace(/^%/, "") ? <span className="lb7-value__top">{after.join("").trim().replace(/^%/, "")}</span> : null}
    </>
  );
}

function windowLabel(rows: readonly LeaderboardRow[], period: LeaderboardPeriod, locale: string): string {
  const today = new Date();
  const endKey = rows[0]?.window_end_date ?? today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const end = new Date(endKey + "T12:00:00");
  if (period === "daily") return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(end);
  const start = new Date(end);
  start.setDate(start.getDate() - (period === "weekly" ? 6 : 29));
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return format.format(start) + " – " + format.format(end);
}

const stroke = { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false } as const;
function DotsIcon() { return <svg {...stroke}><circle cx="3.5" cy="8" r="0.9" fill="currentColor" /><circle cx="8" cy="8" r="0.9" fill="currentColor" /><circle cx="12.5" cy="8" r="0.9" fill="currentColor" /></svg>; }
function ShareIcon() { return <svg {...stroke}><path d="M8 10V2.5M5 5.2 8 2.3l3 2.9" /><path d="M4.5 7.5h-1v6h9v-6h-1" /></svg>; }
function PencilIcon() { return <svg {...stroke} width={12} height={12}><path d="M3 13l1-3.6 6.6-6.6a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L6.6 12 3 13Z" /></svg>; }
function EmbedIcon() { return <svg {...stroke}><path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" /></svg>; }
function LeaveIcon() { return <svg {...stroke}><path d="M6.5 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.5M10 5l3 3-3 3M13 8H6.5" /></svg>; }
/** The Day note's streak flame, so a streak reads the same everywhere. */
function FlameIcon() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" aria-hidden="true" focusable="false" className="lb7-flame">
      <path d="M8 14.6C5.3 14.6 3.4 12.8 3.4 10.3 3.4 8.4 4.5 7 5.6 5.9 5.7 7.1 6.2 8 7 8.4 6.7 5.8 7.8 3.4 9.6 1.6 9.9 3.6 11.2 4.9 12.1 6.3 12.7 7.3 12.6 8.5 12.6 10.3 12.6 12.8 10.7 14.6 8 14.6Z" />
      <path className="lb7-flame__core" d="M8 13.1c-1.1 0-1.9-.8-1.9-1.9 0-.9.6-1.6 1.2-2.3.1.7.5 1.1 1 1.3.1-.9.4-1.6.9-2.1.6.9 1.3 1.8 1.3 2.9 0 1.2-1 2.1-2.5 2.1Z" />
    </svg>
  );
}
function ArrowDownIcon() { return <svg {...stroke} width={12} height={12}><path d="M8 3v9.5M4 8.5l4 4 4-4" /></svg>; }
function ArrowUpIcon() { return <svg {...stroke} width={12} height={12}><path d="M8 13V3.5M4 7.5l4-4 4 4" /></svg>; }
function GlobeIcon() { return <svg {...stroke} width={13} height={13}><circle cx="8" cy="8" r="5.8" /><path d="M2.2 8h11.6M8 2.2c1.8 1.7 1.8 9.9 0 11.6M8 2.2c-1.8 1.7-1.8 9.9 0 11.6" /></svg>; }
function GitHubIcon() { return <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.3 6.8 9.6.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.5-1.1-4.5-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1 .8-.2 1.6-.3 2.5-.3s1.7.1 2.5.3c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.5 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.3 6.8-5.1 6.8-9.6C22 6.6 17.5 2 12 2Z" /></svg>; }
function LinkedInIcon() { return <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" focusable="false"><path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.5-1 1.8-2 3.7-2 3.9 0 4.6 2.6 4.6 5.9V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9z" /></svg>; }

