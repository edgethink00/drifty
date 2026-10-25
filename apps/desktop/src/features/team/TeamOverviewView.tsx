import { Fragment, useMemo, useState, type ReactNode } from "react";

import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { TeamFocusDataset, TeamOverviewContext, TeamOverviewModel, TeamWindow } from "./teamFocusModel";
import { buildTeamOverviewModel } from "./teamFocusModel";
import { readTeamMembersLayout, writeTeamMembersLayout, type TeamMembersLayout } from "./teamMembersLayout";
import type { TeamSharingScope } from "./teamSharingScope";
import { scopeSharesMemberFocus, scopeSharesTeamFocus } from "./teamSharingScope";
import type { TeamGroup, TeamMembershipRole, TeamProject } from "./teamTypes";
import { TeamHeadline, TeamPrivacyNote, describeDelta, describeScope } from "./TeamFocusParts";
import {
  TeamFocusByDayPanel,
  TeamPeopleGrid,
  TeamPeopleList,
  TeamProjectRankPanel,
  type TeamPeopleSort,
  type TeamProjectPanelVariant,
} from "./TeamMembersSections";
import { SettingsSelect } from "../settings/SettingsSelect";
import { TeamMemberSelfShare, TeamMemberSelfShareLine } from "./TeamMemberSelfShare";
import type { TeamSharingPolicy } from "./teamSharingPolicy";
import { TEAM_MEMBER_TOOLS, type TeamMemberSelfView } from "./teamPreviewScenarios";

export type TeamOverviewViewProps = {
  readonly teamName: string;
  readonly scope: TeamSharingScope;
  readonly model: TeamOverviewModel;
  readonly dataset: TeamFocusDataset;
  readonly context: TeamOverviewContext;
  readonly groups: readonly TeamGroup[];
  readonly projects: readonly TeamProject[];
  /** The container's groups from the top down; empty at the organization level. */
  readonly containerPath: readonly TeamGroup[];
  readonly window: TeamWindow;
  readonly viewerRole: TeamMembershipRole;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenMember: (memberKey: string) => void;
  readonly onOpenGroup: (groupId: string | null) => void;
  /** Which right-hand card answers "what the team worked on"; the donut is a Dev-preview candidate. */
  readonly projectPanel?: TeamProjectPanelVariant;
  /** Per-item sharing: a member whose team keeps its summary for managers sees only their own row. */
  readonly summaryHidden?: boolean;
  /** Per-item sharing: whether project time is shared at all, and per person. */
  readonly projectsShared?: boolean;
  readonly memberProjectFigure?: boolean;
  /** No one else's cards: a manager with team totals, or a team that shares nothing per person. Teams still show; with none, the section goes. */
  readonly peopleHidden?: boolean;
  /** For a manager, which teams they manage and how far they see. */
  readonly scopeLine?: string | null;
  /**
   * Whether this seat can see the organization level. A member or a manager
   * of one team or one division starts at that group, so the crumbs start
   * there too instead of naming a level they cannot open.
   */
  readonly organizationReachable?: boolean;
  /**
   * A view that adds several teams together (the organization, a division, a
   * manager's several teams). It shows project time only; focus and people's
   * figures stay inside each team, on that team's sharing.
   */
  readonly acrossTeams?: boolean;
  /** For a member: their own team's policy, for what managers see of them. */
  readonly memberPolicy?: TeamSharingPolicy | null;
  /** Dev candidate for a member's own part of the page. */
  readonly selfView?: TeamMemberSelfView;
  /** Candidates C and D: the member's own page (or why there is none), in place of the people. */
  readonly selfPage?: ReactNode;
  /** Outside the team's recording hours, said once instead of everyone `0 tracking`. */
  readonly offHoursNote?: string | null;
  /** Across teams with focus from some of them (decision candidate C): which teams it leaves out. */
  readonly focusNote?: string | null;
  /**
   * The single-scope beta's footnote naming its scope. Teams with per-item
   * sharing keep no footnote (owner decision 2026-10-18).
   */
  readonly privacyNoteShown?: boolean;
  /** Decision candidates B and C: the page title holds the path, so the small one above the headline goes. */
  readonly crumbsInTitle?: boolean;
};

/**
 * The team's window, top down: a short headline, the two team panels (focus
 * by day beside focus by project), then the people as a name and one figure
 * each. A person's days and blocks are on their own page.
 */
export function TeamOverviewView({
  teamName,
  scope,
  model,
  dataset,
  context,
  groups,
  projects: _projects,
  containerPath,
  window: _timeWindow,
  viewerRole,
  loading,
  error,
  onOpenMember,
  onOpenGroup,
  projectPanel = "donut",
  summaryHidden = false,
  projectsShared = true,
  memberProjectFigure = true,
  peopleHidden = false,
  scopeLine = null,
  organizationReachable = true,
  acrossTeams = false,
  memberPolicy = null,
  selfView = "preview",
  selfPage = null,
  offHoursNote = null,
  focusNote = null,
  privacyNoteShown = true,
  crumbsInTitle = false,
}: TeamOverviewViewProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [sort, setSort] = useState<TeamPeopleSort>("name");
  const [query, setQuery] = useState("");
  // Under review (2026-10-25): sorting by time ranks people, so the recommendation leaves search and grid or list.
  const memberTools = TEAM_MEMBER_TOOLS.read();
  // Grid or list takes the period switch's look with the boards and Settings' sections (candidate A); the others keep the bordered switch.
  // Grid or list switches a mode, so it keeps the period switch's look whichever tabs are under review.
  const viewSwitchClass = "team-subnav team-subnav--range team-view-switch";
  const viewTabClass = (on: boolean) => "team-subnav__tab" + (on ? " on" : "");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Candidate C has no switch: cards while they fit a screen or two, a list beyond. */
  const AUTO_LIST_AFTER = 12;
  const teamFocus = scopeSharesTeamFocus(scope);
  const memberFocus = scopeSharesMemberFocus(scope);
  const [membersLayout, setMembersLayout] = useState<TeamMembersLayout>(readTeamMembersLayout);
  const chooseLayout = (next: TeamMembersLayout) => {
    setMembersLayout(next);
    writeTeamMembersLayout(next);
  };
  const container = containerPath[containerPath.length - 1] ?? null;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);

  // A search flattens groups into the people who match; a member only ever sees themself.
  const needle = query.trim().toLowerCase();
  const flattened = useMemo(() => (
    needle && groups.length > 0 ? buildTeamOverviewModel(dataset, { ...context, flattenGroups: true }) : null
  ), [context, dataset, groups.length, needle]);
  const sourceCards = flattened?.memberCards ?? model.memberCards;
  // An organization admin sits above the teams, so at the top level their own card would stand alone under them.
  const loneSelfAtTop = !needle && !container && groups.length > 0 && viewerRole !== "member"
    && sourceCards.length === 1 && sourceCards[0]!.member.is_self;
  const visibleCards = sourceCards.filter((card) => {
    if (peopleHidden) return false;
    if (loneSelfAtTop) return false;
    if (viewerRole === "member" && !card.member.is_self) return false;
    if (!needle) return true;
    return card.member.display_name.toLowerCase().includes(needle) || card.member.role_label.toLowerCase().includes(needle);
  });
  const visibleGroups = needle ? [] : model.groupCards;
  const rowCount = visibleGroups.length + visibleCards.length;
  const shownLayout: TeamMembersLayout = memberTools === "auto" ? (rowCount > AUTO_LIST_AFTER ? "list" : "grid") : membersLayout;
  // The section is named for what it lists: divisions, teams, people, or several of these.
  const divisionCount = visibleGroups.filter((card) => groups.some((group) => group.parent_group_id === card.group.id)).length;
  const sectionParts = [
    { key: "divisions", label: t("team.focus.section.divisions"), count: divisionCount },
    { key: "teams", label: t("team.focus.section.teams"), count: visibleGroups.length - divisionCount },
    { key: "people", label: t("team.focus.members"), count: visibleCards.length },
  ].filter((part) => part.count > 0);
  // Nothing to list for someone who may see no one: the whole section goes, not a notice in its place.
  const peopleSectionShown = !(peopleHidden && visibleGroups.length === 0);
  // No totals for a member whose team keeps its summary: the headline keeps the name and size, the team panels go.
  const totalsHidden = summaryHidden;
  // Crumbs are the levels above this one that the seat can open.
  const crumbGroups = organizationReachable ? containerPath.slice(0, -1) : containerPath.slice(1, -1);
  const showCrumbs = !crumbsInTitle && (organizationReachable ? containerPath.length > 0 : containerPath.length > 1);

  // The page title already names the team; a group's own name returns in its headline since the crumbs hold only its parents.
  // One noun phrase per case, so every seat reads the same shape: what, then how much.
  const headlineValue = duration(model.teamFocusSeconds);
  // With the path in the title, the headline says what and how much without naming the place again.
  const headline = container && !crumbsInTitle
    ? t(teamFocus ? "team.overview.headline.groupFocus" : "team.overview.headline.groupProjects", { name: container.name, duration: headlineValue })
    : t(teamFocus ? "team.overview.headline.teamFocus" : "team.overview.headline.teamProjects", { duration: headlineValue });
  // Across teams the subline says how many teams the total adds up.
  const teamsInView = acrossTeams ? leafTeamsUnder(groups, container?.id ?? null) : 0;
  const subline = [
    teamsInView > 0 ? t("team.overview.sub.teams", { count: teamsInView }) : null,
    t("team.settings.memberCount", { count: model.memberCount }),
    teamFocus && model.avgPerMemberPerDaySeconds > 0 ? t("team.focus.sub.avgPerDay", { duration: duration(model.avgPerMemberPerDaySeconds) }) : null,
    describeDelta(model.deltaPct, t),
    focusNote,
  ].filter(Boolean).join(" · ");
  const scopeNote = describeScope(scope, t);
  // What the one figure beside each person means; nothing when the scope shares no per-member figure.
  const figureLabel = memberFocus
    ? t("team.focus.figure.focus")
    : !teamFocus && memberProjectFigure ? t("team.focus.figure.projects") : null;
  // Teams show their projects, never a focus total, so they are not ranked by focus.
  const groupFigureLabel = projectsShared && visibleGroups.length > 0 ? t("team.focus.figure.groupProjects") : null;
  // The list names its figures in column heads; the grid names the teams' figure beside the section title and people's above their own tiles.
  const gridCaption = groupFigureLabel ?? figureLabel;
  // F (Rize) cuts the list to the member's own card without saying so, as Rize's timetable keeps their row only.
  const sectionCaption = viewerRole === "member" ? (selfView === "rize" ? null : t("team.focus.memberViewerNote")) : peopleHidden && visibleGroups.length === 0 ? null : membersLayout === "grid" ? gridCaption : null;
  const groupColumnLabel = divisionCount === visibleGroups.length ? t("team.focus.section.divisions") : divisionCount === 0 ? t("team.focus.section.teams") : t("team.focus.col.name");
  const peopleProps = {
    language: effectiveLanguage,
    cards: visibleCards,
    groupCards: visibleGroups,
    groups,
    sort,
    showFocus: memberFocus,
    showTeamFocus: teamFocus,
    showProjectFigure: memberProjectFigure,
    showGroupProjects: projectsShared,
    figureLabel,
    groupColumnLabel,
    peopleColumnLabel: t("team.focus.members"),
    onOpenMember,
    onOpenGroup,
  };
  const timeSort = memberTools === "current" && (memberFocus || (!teamFocus && memberProjectFigure));
  const sortOptions: { readonly value: TeamPeopleSort; readonly label: string }[] = [
    { value: "name", label: t("team.focus.sort.name") },
    ...(timeSort ? [{ value: "focus" as const, label: memberFocus ? t("team.focus.sort.focus") : t("team.focus.sort.projectTime") }] : []),
    ...(groups.length > 0 ? [{ value: "group" as const, label: t("team.focus.sort.group") }] : []),
  ];
  const canSort = memberTools === "current" && visibleCards.length > 1 && (timeSort || groups.length > 0);
  const showByDay = teamFocus || projectsShared;
  const selfCard = model.memberCards.find((card) => card.member.is_self) ?? null;
  // A member's own part: what their managers see of them (candidate A), or their card with one line (B).
  const selfPreview = viewerRole === "member" && memberPolicy !== null && selfView === "preview";

  const panels = totalsHidden ? null : showByDay || projectsShared ? (
    <div className={"team-focus__panels" + (showByDay && projectsShared ? "" : " team-focus__panels--single")}>
      {showByDay ? <TeamFocusByDayPanel model={model} language={effectiveLanguage} showProjects={projectsShared} /> : null}
      {projectsShared ? <TeamProjectRankPanel shares={model.focusByProject} language={effectiveLanguage} variant={projectPanel} /> : null}
    </div>
  ) : null;

  // C puts the member's own page where the people would be; D gives it a tab and leaves the totals here.
  // E keeps a member's own records in the personal views, as Rize and RescueTime do: nothing of theirs here.
  const selfInPlace = viewerRole === "member" && (selfView === "page" || selfView === "tab" || selfView === "none");
  const people = selfInPlace ? selfPage : selfPreview ? (
    <TeamMemberSelfShare policy={memberPolicy} card={selfCard} onOpen={() => { if (selfCard) onOpenMember(selfCard.member.member_key); }} />
  ) : peopleSectionShown ? (
    <div className="team-focus__people">
      <div className="team-focus__tools">
        <h3 className="team-focus__section-title label-mono">
          {sectionParts.length === 0 ? <span>{t("team.focus.members")}</span> : sectionParts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? <span className="team-focus__count" aria-hidden="true">·</span> : null}
              <span>{part.label}</span>
              <span className="team-focus__count">{part.count}</span>
            </Fragment>
          ))}
        </h3>
        {sectionCaption ? <span className="team-focus__caption">{sectionCaption}</span> : null}
        {offHoursNote ? (
          <span className="team-focus__live is-idle">
            <span className="team-live" aria-hidden="true" />
            {offHoursNote}
          </span>
        ) : model.trackingNow ? (
          <span className={"team-focus__live" + (model.trackingNow.count > 0 ? "" : " is-idle")} title={t("team.focus.stat.trackingNow")}>
            <span className={"team-live" + (model.trackingNow.count > 0 ? " is-on" : "")} aria-hidden="true" />
            {t("team.focus.trackingCount", { count: model.trackingNow.count, total: model.trackingNow.total })}
          </span>
        ) : null}
        {/* The team Projects tab's toolbar pieces: its search field and its SettingsSelect. Nothing to search or arrange without people, or with only yourself. */}
        {peopleHidden || viewerRole === "member" ? null : <div className="team-focus__tool-group">
          {memberTools === "icon" && !searchOpen && query === "" ? (
            <button type="button" className="team-focus__search-button" aria-label={t("team.focus.searchMembers")} title={t("team.focus.searchMembers")} onClick={() => setSearchOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </button>
          ) : (
            <span className="projects-search team-focus__search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                className="settings-input"
                type="text"
                placeholder={t("team.focus.searchMembers")}
                aria-label={t("team.focus.searchMembers")}
                value={query}
                autoFocus={memberTools === "icon"}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={() => { if (query === "") setSearchOpen(false); }}
                onKeyDown={(event) => { if (event.key === "Escape" && memberTools === "icon") { setQuery(""); setSearchOpen(false); } }}
              />
            </span>
          )}
          {canSort ? (
            <SettingsSelect ariaLabel={t("team.focus.sortAria")} className="projects-status-filter team-focus__sort" value={sort} options={sortOptions} onChange={setSort} />
          ) : null}
          {memberTools === "auto" ? null : <div className={viewSwitchClass} role="group" aria-label={t("team.focus.viewAria")}>
            <button type="button" className={viewTabClass(membersLayout === "grid")} aria-pressed={membersLayout === "grid"} aria-label={t("team.focus.view.grid")} title={t("team.focus.view.grid")} onClick={() => chooseLayout("grid")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></svg>
            </button>
            <button type="button" className={viewTabClass(membersLayout === "list")} aria-pressed={membersLayout === "list"} aria-label={t("team.focus.view.list")} title={t("team.focus.view.list")} onClick={() => chooseLayout("list")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
            </button>
          </div>}
        </div>}
      </div>
      {rowCount === 0 ? (
        <div className="team-empty">{loading ? t("team.dashboard.loadingTime") : needle ? t("team.focus.noMatches") : t("team.focus.noMembers")}</div>
      ) : shownLayout === "list" ? (
        <TeamPeopleList {...peopleProps} />
      ) : (
        <TeamPeopleGrid {...peopleProps} />
      )}
      {viewerRole === "member" && memberPolicy && selfView === "line" ? <TeamMemberSelfShareLine policy={memberPolicy} /> : null}
      {error ? <p className="team-message team-message--error">{error}</p> : null}
    </div>
  ) : error ? <p className="team-message team-message--error">{error}</p> : null;

  return (
    <section className="team-focus" aria-label={t("team.focus.overviewAria")}>
      <header className="team-focus__head">
        {showCrumbs ? (
          <nav className="team-crumbs" aria-label={t("team.focus.crumbsAria")}>
            {organizationReachable ? <button type="button" className="team-crumbs__link" onClick={() => onOpenGroup(null)}>{teamName}</button> : (
              <button type="button" className="team-crumbs__link" onClick={() => onOpenGroup(null)}>{containerPath[0]!.name}</button>
            )}
            {crumbGroups.map((group) => (
              <span key={group.id} className="team-crumbs__item">
                <span className="team-crumbs__sep" aria-hidden="true">/</span>
                <button type="button" className="team-crumbs__link" onClick={() => onOpenGroup(group.id)}>{group.name}</button>
              </span>
            ))}
          </nav>
        ) : null}
        {totalsHidden ? (
          container ? (
            <>
              {/* With the path in the title the place is already named; the size stays. */}
              {crumbsInTitle ? null : <TeamHeadline text={container.name} value="" />}
              <p className="team-focus__sub">{t("team.settings.memberCount", { count: model.memberCount })}</p>
              {scopeLine ? <p className="team-focus__scope">{scopeLine}</p> : null}
            </>
          ) : scopeLine ? <p className="team-focus__scope">{scopeLine}</p> : null
        ) : (
          <>
            <TeamHeadline text={headline} value={headlineValue} />
            <p className="team-focus__sub">{subline}</p>
            {scopeLine ? <p className="team-focus__scope">{scopeLine}</p> : null}
          </>
        )}
      </header>

      {panels}
      {people}

      {privacyNoteShown ? <TeamPrivacyNote>{scopeNote}</TeamPrivacyNote> : null}
    </section>
  );
}

/** Teams (groups with no groups inside) under a group, or in the whole organization. */
function leafTeamsUnder(groups: readonly TeamGroup[], groupId: string | null): number {
  const inside = (group: TeamGroup): boolean => {
    if (groupId === null) return true;
    let current = group.parent_group_id;
    while (current !== null) {
      if (current === groupId) return true;
      current = groups.find((candidate) => candidate.id === current)?.parent_group_id ?? null;
    }
    return false;
  };
  return groups.filter((group) => !groups.some((child) => child.parent_group_id === group.id) && inside(group)).length;
}

export default TeamOverviewView;

