import { useState, type CSSProperties } from "react";

import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import { useLocalization } from "../localization/LocalizationContext";
import { ProjectsSharePanel } from "../projects/ProjectsSharePanel";
import type { TeamGroupCardModel, TeamMemberCardModel, TeamOverviewModel, TeamProjectShare } from "./teamFocusModel";
import type { TeamGroup } from "./teamTypes";
import { TEAM_UNASSIGNED_COLOR, TeamAvatar, TeamCard, TeamGroupMark, TeamMixBar, TeamTrendChart } from "./TeamFocusParts";

/**
 * The Overview's two team cards and its people. Each piece is an existing
 * app design: the chart is the shared ProjectTrendBars, the project list is
 * Insights' ranked source rows (or, as a candidate, the Projects page's share
 * dial), the people list is the team Projects tab's table. People stay
 * abstract: a name, a role and one figure; their days live on their own page.
 * Teams carry what they worked on (the Breakdown's category stack over their
 * projects) and never a focus total, so they are not ranked against each other.
 */

export type TeamPeopleSort = "name" | "focus" | "group";
export type TeamProjectPanelVariant = "list" | "donut";

export function sortMembers(cards: readonly TeamMemberCardModel[], sort: TeamPeopleSort, groups: readonly TeamGroup[], figure: (card: TeamMemberCardModel) => number): readonly TeamMemberCardModel[] {
  const groupName = (groupId: string | null): string => groups.find((group) => group.id === groupId)?.name ?? "";
  const byName = (left: TeamMemberCardModel, right: TeamMemberCardModel) => left.member.display_name.localeCompare(right.member.display_name);
  const sorted = [...cards];
  if (sort === "focus") sorted.sort((left, right) => figure(right) - figure(left) || byName(left, right));
  else if (sort === "group") sorted.sort((left, right) => groupName(left.member.group_id).localeCompare(groupName(right.member.group_id)) || byName(left, right));
  else sorted.sort(byName);
  return sorted;
}

/** The one figure a person shows: their focus time, or below that scope their time on team projects. */
export function memberFigureSeconds(card: TeamMemberCardModel, showFocus: boolean): number {
  return showFocus ? card.focusSeconds : card.projects.reduce((sum, share) => sum + share.seconds, 0);
}

export type PeopleProps = {
  readonly language: DisplayLanguage;
  readonly cards: readonly TeamMemberCardModel[];
  readonly groupCards: readonly TeamGroupCardModel[];
  readonly groups: readonly TeamGroup[];
  readonly sort: TeamPeopleSort;
  /** Per-member focus time is shared (member_focus scope or above). */
  readonly showFocus: boolean;
  /** Pooled focus time is shared (team_focus scope or above), so groups can show a total. */
  readonly showTeamFocus: boolean;
  /** Whether a person's project time may stand as their figure; false when projects are shared only as team totals. */
  readonly showProjectFigure?: boolean;
  /** Whether project time is shared at all, so a team's card can show its projects. */
  readonly showGroupProjects?: boolean;
  /** What the one figure is ("Focus time", "Time on team projects"); null when people carry no figure. */
  readonly figureLabel: string | null;
  /** The list's first column heads, named for what each table lists ("Teams", "Divisions", "Members"). */
  readonly groupColumnLabel?: string;
  readonly peopleColumnLabel?: string;
  readonly onOpenMember: (memberKey: string) => void;
  readonly onOpenGroup: (groupId: string) => void;
};

function StatusDot({ tracking }: { readonly tracking: boolean | null }): JSX.Element | null {
  const { t } = useLocalization();
  if (tracking === null) return null;
  return <span className={"team-live" + (tracking ? " is-on" : "")} title={tracking ? t("team.focus.tracking") : t("team.focus.offline")} />;
}

/**
 * A person's role label is free text, but the server writes the seat words
 * ("Owner", "Admin", "Member", "Team Lead") when nobody set a title; those read
 * in the app's own seat names. Any other title shows as written.
 */
export function displayRoleLabel(label: string, t: ReturnType<typeof useLocalization>["t"]): string {
  switch (label.trim().toLowerCase()) {
    case "owner":
    case "admin":
      return t("team.role.owner");
    case "lead":
    case "team lead":
      return t("team.role.lead");
    case "member":
      return t("team.role.member");
    default:
      return label;
  }
}

function PersonName({ card }: { readonly card: TeamMemberCardModel }): JSX.Element {
  const { t } = useLocalization();
  return (
    <span className="team-person__who">
      <strong><StatusDot tracking={card.tracking} /><span className="team-person__name">{card.member.display_name}</span>{card.member.is_self ? <span className="team-you-chip">{t("team.dashboard.you")}</span> : null}</strong>
      <span className="team-person__meta">{displayRoleLabel(card.member.role_label, t)}</span>
    </span>
  );
}

/* The list row has room for the tracking count beside the size; a tile carries it under its figure. */
function GroupName({ card, withTracking = true }: { readonly card: TeamGroupCardModel; readonly withTracking?: boolean }): JSX.Element {
  const { t } = useLocalization();
  return (
    <span className="team-person__who">
      <strong><span className="team-person__name">{card.group.name}</span></strong>
      <span className="team-person__meta">
        {card.childGroupCount > 0
          ? t("team.focus.groupMeta.nested", { teams: card.childGroupCount, members: card.memberCount })
          : t("team.focus.groupMeta.flat", { members: card.memberCount })}
        {withTracking && card.trackingCount !== null && card.memberCount > 0 ? " · " + t("team.focus.trackingCountShort", { count: card.trackingCount }) : ""}
      </span>
    </span>
  );
}

function sparseNote(card: TeamMemberCardModel, t: ReturnType<typeof useLocalization>["t"]): string | null {
  return card.sparse ? t("team.focus.trackedDays", { tracked: card.trackedDays, expected: card.expectedDays }) : null;
}

/** A team card's stack names its top three projects; the rest fold into one quiet segment. */
const GROUP_MIX_NAMED = 3;
const GROUP_MIX_OTHER_COLOR = "var(--line-strong)";

/**
 * A team's projects: its project time as a small figure (on a tile), the
 * Breakdown's category stack over its top projects, then its biggest project
 * by name and share.
 */
function GroupProjectMix({ card, language, withTime }: { readonly card: TeamGroupCardModel; readonly language: DisplayLanguage; readonly withTime: boolean }): JSX.Element | null {
  const { t } = useLocalization();
  const top = card.projectShares[0] ?? null;
  if (!top || card.projectSeconds <= 0) return null;
  const pct = Math.round((top.seconds / card.projectSeconds) * 100);
  const named = card.projectShares.slice(0, GROUP_MIX_NAMED);
  const restSeconds = card.projectShares.slice(GROUP_MIX_NAMED).reduce((sum, share) => sum + share.seconds, 0);
  const stack: readonly TeamProjectShare[] = restSeconds > 0
    ? [...named, { projectId: "other-projects", name: t("team.focus.otherProjects"), color: GROUP_MIX_OTHER_COLOR, seconds: restSeconds }]
    : named;
  return (
    <span className="team-group-mix">
      {withTime ? <strong className="team-group-mix__time">{formatLocalizedCompactDurationFromSeconds(card.projectSeconds, language)}</strong> : null}
      <TeamMixBar shares={stack} size="md" label={t("team.focus.groupMixAria", { name: card.group.name })} />
      <span className="team-group-mix__line">
        <span className="team-legend-swatch" style={{ background: top.color ?? TEAM_UNASSIGNED_COLOR }} aria-hidden="true" />
        <span className="team-group-mix__name">{top.name ?? t("team.focus.unassigned")}</span>
        <span className="team-group-mix__pct">{pct}%</span>
      </span>
    </span>
  );
}

function GroupTracking({ card }: { readonly card: TeamGroupCardModel }): JSX.Element | null {
  const { t } = useLocalization();
  // A team nobody has joined yet has no one to track.
  if (card.trackingCount === null || card.memberCount === 0) return null;
  return (
    <small className={"team-tile__live" + (card.trackingCount > 0 ? "" : " is-idle")}><span className={"team-live" + (card.trackingCount > 0 ? " is-on" : "")} aria-hidden="true" />{t("team.focus.trackingCountShort", { count: card.trackingCount })}</small>
  );
}

/*
 * Grid: tiles to a row, a name and one figure each. Teams come first; when
 * people follow them (an organization admin outside any team), they get their
 * own run of tiles under a small head, as the list gives them their own table.
 */
export function TeamPeopleGrid({ language, cards, groupCards, groups, sort, showFocus, showTeamFocus, showProjectFigure = true, showGroupProjects = true, figureLabel, peopleColumnLabel, onOpenMember, onOpenGroup }: PeopleProps): JSX.Element {
  const { t } = useLocalization();
  const figure = (card: TeamMemberCardModel) => memberFigureSeconds(card, showFocus);
  const sorted = sortMembers(cards, sort, groups, figure);
  const showFigure = showFocus || (!showTeamFocus && showProjectFigure);
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const groupTiles = groupCards.map((card) => {
        const mix = showGroupProjects ? <GroupProjectMix card={card} language={language} withTime /> : null;
        return (
          <button type="button" key={card.group.id} className="team-tile team-tile--group" onClick={() => onOpenGroup(card.group.id)} aria-label={t("team.focus.openGroupAria", { name: card.group.name })}>
            <span className="team-tile__head"><TeamGroupMark name={card.group.name} /><GroupName card={card} withTracking={false} /></span>
            {mix || card.trackingCount !== null ? (
              <span className="team-tile__figure">
                {mix}
                <GroupTracking card={card} />
              </span>
            ) : null}
          </button>
        );
  });
  const personTiles = sorted.map((card) => {
        const note = sparseNote(card, t);
        return (
          <button type="button" key={card.member.member_key} className="team-tile" onClick={() => onOpenMember(card.member.member_key)} aria-label={t("team.focus.openMemberAria", { name: card.member.display_name })}>
            <span className="team-tile__head"><TeamAvatar name={card.member.display_name} size="md" /><PersonName card={card} /></span>
            {showFigure ? (
              <span className="team-tile__figure">
                <strong>{duration(figure(card))}</strong>
                {note ? <small>{note}</small> : null}
              </span>
            ) : null}
          </button>
        );
  });
  if (groupTiles.length === 0 || personTiles.length === 0) return <div className="team-tiles">{groupTiles}{personTiles}</div>;
  return (
    <div className="team-tile-runs">
      <div className="team-tiles">{groupTiles}</div>
      <div className="team-tile-runs__head">
        <h4 className="team-focus__section-title label-mono">{peopleColumnLabel ?? t("team.focus.members")}<span className="team-focus__count">{personTiles.length}</span></h4>
        {showFigure && figureLabel ? <span className="team-focus__caption">{figureLabel}</span> : null}
      </div>
      <div className="team-tiles">{personTiles}</div>
    </div>
  );
}

/*
 * List: the team Projects tab's table. Teams and people are different rows
 * (a project split against one figure), so each gets its own table with its
 * own heads; an organization admin's own row sits under the teams.
 */
export function TeamPeopleList({ language, cards, groupCards, groups, sort, showFocus, showTeamFocus, showProjectFigure = true, showGroupProjects = true, figureLabel, groupColumnLabel, peopleColumnLabel, onOpenMember, onOpenGroup }: PeopleProps): JSX.Element {
  const { t } = useLocalization();
  const figure = (card: TeamMemberCardModel) => memberFigureSeconds(card, showFocus);
  const sorted = sortMembers(cards, sort, groups, figure);
  const showFigure = showFocus || (!showTeamFocus && showProjectFigure);
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const groupName = (groupId: string | null): string => groups.find((group) => group.id === groupId)?.name ?? "";
  return (
    <div className="team-people-tables">
      {groupCards.length > 0 ? (
        <div className="projects-table team-people-table team-people-table--groups" role="region" aria-label={groupColumnLabel ?? t("team.focus.section.teams")}>
          <div className="projects-table__head team-people-table__cols">
            <span>{groupColumnLabel ?? t("team.focus.section.teams")}</span>
            <span>{showGroupProjects ? t("team.focus.col.topProjects") : ""}</span>
            <span>{showGroupProjects ? t("team.focus.col.projectTime") : ""}</span>
            <span />
          </div>
          {groupCards.map((card) => (
            <div className="projects-table__rowwrap" key={card.group.id}>
              <button type="button" className="projects-table__row team-people-table__cols" onClick={() => onOpenGroup(card.group.id)} aria-label={t("team.focus.openGroupAria", { name: card.group.name })}>
                <span className="team-people-table__who"><TeamGroupMark name={card.group.name} size="sm" /><GroupName card={card} /></span>
                <span className="team-people-table__mix">{showGroupProjects ? <GroupProjectMix card={card} language={language} withTime={false} /> : null}</span>
                <span className="pt-total"><b>{showGroupProjects && card.projectSeconds > 0 ? duration(card.projectSeconds) : ""}</b></span>
                <span className="team-people-table__chev" aria-hidden="true">›</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {sorted.length > 0 ? <div className="projects-table team-people-table team-people-table--people" role="region" aria-label={peopleColumnLabel ?? t("team.focus.members")}>
      <div className="projects-table__head team-people-table__cols">
        <span>{peopleColumnLabel ?? t("team.focus.col.member")}</span>
        <span>{figureLabel ?? ""}</span>
        <span />
      </div>
      {sorted.map((card) => {
        const note = sparseNote(card, t);
        return (
          <div className="projects-table__rowwrap" key={card.member.member_key}>
            <button type="button" className="projects-table__row team-people-table__cols" onClick={() => onOpenMember(card.member.member_key)} aria-label={t("team.focus.openMemberAria", { name: card.member.display_name })}>
              <span className="team-people-table__who">
                <TeamAvatar name={card.member.display_name} size="sm" />
                <PersonName card={card} />
                {sort === "group" && card.member.group_id ? <span className="team-people-table__group">{groupName(card.member.group_id)}</span> : null}
              </span>
              <span className="pt-total">
                <b>{showFigure ? duration(figure(card)) : ""}</b>
                {showFigure && note ? <small className="team-person__sparse">{note}</small> : null}
              </span>
              <span className="team-people-table__chev" aria-hidden="true">›</span>
            </button>
          </div>
        );
      })}
      </div> : null}
    </div>
  );
}

/* Team card, left: the container's time per day, stacked by project, on the shared chart */
export function TeamFocusByDayPanel({ model, language, showProjects }: { readonly model: TeamOverviewModel; readonly language: DisplayLanguage; readonly showProjects: boolean }): JSX.Element {
  const { t } = useLocalization();
  const title = showProjects ? t("team.focus.projectByDay") : t("team.focus.byDay");
  // Project time covers all assigned recording time; it is independent of focus.
  // When projects are private, draw the shared daily focus totals on their own.
  const focusSeries: TeamProjectShare = { projectId: "team-focus", name: t("team.focus.figure.focus"), color: "var(--accent)", seconds: model.teamFocusSeconds };
  // Past days only; the window's future days would draw as an empty run at the end.
  const days = showProjects
    ? model.focusByDayProject.filter((entry) => !model.focusByDay.find((point) => point.day === entry.day)?.isFuture)
    : model.focusByDay.filter((point) => !point.isFuture).map((point) => ({ day: point.day, shares: [{ ...focusSeries, seconds: point.seconds }] }));
  const hasTime = days.some((entry) => entry.shares.some((share) => share.seconds > 0));
  return (
    <TeamCard id="team-byday-heading" title={title} className="team-card--chart">
      {hasTime ? (
        <TeamTrendChart days={days} order={showProjects ? model.focusByProject : [focusSeries]} language={language} ariaLabel={title} unassignedLabel={t("team.focus.unassigned")} />
      ) : (
        <div className="team-empty">{t("team.focus.noFocusYet")}</div>
      )}
    </TeamCard>
  );
}

/**
 * The share dial names every project up to five. Past that its folded
 * "N more" slice would outweigh the projects it names, so the ranked rows
 * (with their pager) take over.
 */
export const TEAM_DIAL_MAX_PROJECTS = 5;
/** The ranked rows page by the same five, and the day chart beside them is cut to their height. */
const PROJECT_PAGE_SIZE = TEAM_DIAL_MAX_PROJECTS;

/**
 * Team card, right: where the team's time went. The default is the Projects
 * page's share dial with unassigned kept as its own slice, for up to five
 * projects; beyond that, and as the Dev candidate, Insights' ranked source
 * rows (rank, name, time, a bar against the biggest) with their pager.
 */
export function TeamProjectRankPanel({ shares, language, variant = "donut", title: titleOverride, id = "team-rank-heading", selectedProjectId, onProjectSelect, projectDetailsId }: {
  readonly shares: readonly TeamProjectShare[];
  readonly language: DisplayLanguage;
  readonly variant?: TeamProjectPanelVariant;
  readonly title?: string;
  readonly id?: string;
  /** undefined is closed, null is the permitted unassigned slice. */
  readonly selectedProjectId?: string | null;
  readonly onProjectSelect?: (projectId: string | null) => void;
  readonly projectDetailsId?: string;
}): JSX.Element {
  const { t } = useLocalization();
  const [page, setPage] = useState(0);
  const total = shares.reduce((sum, share) => sum + share.seconds, 0);
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const nameOf = (share: TeamProjectShare) => share.name ?? t("team.focus.unassigned");
  const colorOf = (share: TeamProjectShare) => share.color ?? TEAM_UNASSIGNED_COLOR;
  const title = titleOverride ?? t("team.focus.workedOn");

  const named = shares.filter((share) => share.projectId !== null);
  if (variant === "donut" && named.length <= TEAM_DIAL_MAX_PROJECTS) {
    const unassigned = shares.find((share) => share.projectId === null) ?? null;
    return (
      <ProjectsSharePanel
        projects={named.map((share) => ({ id: share.projectId!, name: nameOf(share), color: colorOf(share), total: share.seconds }))}
        trailing={unassigned ? { id: "unassigned", name: nameOf(unassigned), color: colorOf(unassigned), total: unassigned.seconds } : null}
        namedCount={TEAM_DIAL_MAX_PROJECTS}
        days={0}
        caption={title}
        selectedProjectId={selectedProjectId === undefined ? null : selectedProjectId ?? "unassigned"}
        onProjectSelect={onProjectSelect ? (key) => onProjectSelect(key === "unassigned" ? null : key) : undefined}
        projectDetailsId={projectDetailsId}
      />
    );
  }

  const pageSize = PROJECT_PAGE_SIZE;
  const lastPage = Math.max(0, Math.ceil(shares.length / pageSize) - 1);
  const current = Math.min(page, lastPage);
  const start = current * pageSize;
  const visible = shares.slice(start, start + pageSize);
  const max = Math.max(1, ...shares.map((share) => share.seconds));
  const pager = lastPage > 0 ? (
    <div className="insight-source-pager">
      <span aria-live="polite">{start + 1}–{Math.min(start + pageSize, shares.length)} / {shares.length}</span>
      <button type="button" disabled={current === 0} aria-label={t("trends.sources.previous", { label: title })} onClick={() => setPage(current - 1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>
      </button>
      <button type="button" disabled={current === lastPage} aria-label={t("trends.sources.next", { label: title })} onClick={() => setPage(current + 1)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
      </button>
    </div>
  ) : null;
  return (
    <TeamCard id={id} title={title} total={total > 0 ? duration(total) : null} aside={pager} className="team-card--projects">
      {total <= 0 ? <div className="team-empty">{t("team.focus.noProjectTime")}</div> : (
        <div className="drift-time-trend__sources-items team-sources">
          {visible.map((share, index) => {
            const unassigned = share.projectId === null;
            const pct = Math.round((share.seconds / total) * 100);
            const Row = onProjectSelect ? "button" : "div";
            return (
              <Row
                key={share.projectId ?? "unassigned"}
                type={onProjectSelect ? "button" : undefined}
                aria-label={onProjectSelect ? t("projects.share.details", { name: nameOf(share) }) : undefined}
                aria-expanded={onProjectSelect ? selectedProjectId === share.projectId : undefined}
                aria-controls={onProjectSelect && selectedProjectId === share.projectId ? projectDetailsId : undefined}
                onClick={onProjectSelect ? () => onProjectSelect(share.projectId) : undefined}
                className={"drift-time-trend__sources-item team-sources__item" + (unassigned ? " is-unassigned" : "")}
                style={{ "--trend-tone": colorOf(share) } as CSSProperties}
                title={nameOf(share) + " · " + duration(share.seconds) + " (" + pct + "%)"}
              >
                <span className="drift-time-trend__sources-rank" aria-hidden="true">{unassigned ? "–" : start + index + 1}</span>
                <span className="drift-time-trend__sources-name">{nameOf(share)}</span>
                <strong className="drift-time-trend__sources-value">{duration(share.seconds)}<span className="team-sources__pct">{pct}%</span></strong>
                <span className="drift-source-bar" aria-hidden="true"><span className="drift-source-bar__fill" style={{ width: Math.max(3, (share.seconds / max) * 100) + "%" }} /></span>
              </Row>
            );
          })}
        </div>
      )}
      {onProjectSelect && shares.length > 0 ? <p className="projects-share__detail-hint">{t("projects.share.detailsHint")}</p> : null}
    </TeamCard>
  );
}

