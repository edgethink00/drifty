import { Fragment, type Dispatch, type SetStateAction } from "react";

import { AnchoredPresence } from "../components/AnchoredPresence";
import type { DashboardPeriod } from "../features/dashboard/dashboardPeriods";
import type { LocalizationController } from "../features/localization/LocalizationContext";
import type { OwnTeam } from "../features/team/teamTypes";
import type { TeamWorkspaceAction } from "../features/team/TeamWorkspace";
import type { TeamProjectsSubView } from "../features/team/useTeamProjects";
import { NavIcon } from "./AppShell";
import { activityNav, dashboardPeriodOptions, primaryNav, type NavIconType, type TabId } from "./navigation";

export type SidebarTeamReviewVariant = "leaderboard-first" | "teams-first" | "people-labeled";

export function resolveSidebarTeamReviewVariant(
  search = window.location.search,
  isDev = import.meta.env.DEV,
  envCandidate = import.meta.env.VITE_SIDEBAR_TEAM_VARIANT,
): SidebarTeamReviewVariant {
  if (!isDev) return "leaderboard-first";
  const candidate = new URLSearchParams(search).get("sidebarTeamVariant") ?? envCandidate;
  return candidate === "teams-first" || candidate === "people-labeled"
    ? candidate
    : "leaderboard-first";
}

type SidebarNavigationProps = {
  readonly activeTab: TabId;
  readonly canOpenAgentsBeta: boolean;
  readonly canOpenProfileBeta: boolean;
  readonly canOpenTeamsBeta: boolean;
  readonly dashPeriod: DashboardPeriod;
  readonly isCollapsed: boolean;
  readonly navigationRefreshEnabled: boolean;
  readonly projectClassificationFeatureEnabled: boolean;
  readonly selectedTeam: OwnTeam | null;
  readonly socialSection: "leaderboard" | "profile";
  readonly teamNavExpandedId: string | null | undefined;
  readonly teamNavMenuOpen: boolean;
  readonly teamNavMenuPos: { readonly left: number; readonly top: number } | null;
  readonly teamReviewVariant: SidebarTeamReviewVariant;
  readonly teams: readonly OwnTeam[];
  readonly teamSubView: TeamProjectsSubView;
  readonly t: LocalizationController["t"];
  readonly onNavigate: (tabId: TabId, dashPeriod?: DashboardPeriod) => void;
  readonly onOpenTeamAction: (action: TeamWorkspaceAction) => void;
  readonly onSelectTeam: (organizationId: string) => void;
  readonly onTeamNavExpandedIdChange: Dispatch<SetStateAction<string | null | undefined>>;
  readonly onTeamNavMenuOpenChange: Dispatch<SetStateAction<boolean>>;
  readonly onTeamNavMenuPosChange: Dispatch<SetStateAction<{ readonly left: number; readonly top: number } | null>>;
  readonly onTeamSubViewChange: (subView: TeamProjectsSubView) => void;
};

function SidebarNavButton({
  active,
  collapsed,
  icon,
  label,
  onClick,
  variant,
}: {
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly icon: NavIconType;
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: "period";
}) {
  const className = ["nav-item", variant === "period" ? "nav-item--period" : null, active ? "active" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={className} aria-current={active ? "page" : undefined} onClick={onClick}>
      <NavIcon type={icon} />
      <span>{label}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
    </button>
  );
}

function SocialNavigation({
  activeTab,
  canOpenProfileBeta,
  collapsed,
  socialSection,
  t,
  onNavigate,
}: Pick<SidebarNavigationProps, "activeTab" | "canOpenProfileBeta" | "socialSection" | "t" | "onNavigate"> & { readonly collapsed: boolean }) {
  return (
    <nav className="sidebar-nav sidebar-nav--social" aria-label={t("nav.socialNavigation")}>
      {canOpenProfileBeta ? (
        <SidebarNavButton
          active={activeTab === "leaderboard" && socialSection === "profile"}
          collapsed={collapsed}
          icon="profile"
          label={t("nav.profile")}
          onClick={() => onNavigate("profile")}
        />
      ) : null}
      <SidebarNavButton
        active={activeTab === "leaderboard" && socialSection === "leaderboard"}
        collapsed={collapsed}
        icon="leaderboard"
        label={t("nav.leaderboard")}
        onClick={() => onNavigate("leaderboard")}
      />
    </nav>
  );
}

function TeamDestination({ activeTab, collapsed, t, onNavigate }: Pick<SidebarNavigationProps, "activeTab" | "t" | "onNavigate"> & { readonly collapsed: boolean }) {
  return (
    <nav className="sidebar-nav sidebar-nav--teams" aria-label={t("team.nav.yourTeams")}>
      <SidebarNavButton
        active={activeTab === "team"}
        collapsed={collapsed}
        icon="team"
        label={t("team.nav.teams")}
        onClick={() => onNavigate("team")}
      />
    </nav>
  );
}

function RefreshedNavigation(props: SidebarNavigationProps) {
  const teamDestination = props.canOpenTeamsBeta ? <TeamDestination {...props} collapsed={props.isCollapsed} /> : null;
  return (
    <>
      <nav className="sidebar-nav sidebar-nav--primary" aria-label={props.t("nav.primaryNavigation")}>
        <div className="sidebar-guide-section" data-sidebar-guide-anchor="dashboard">
          {primaryNav.slice(0, 2).map((item) => (
            <SidebarNavButton
              key={item.id}
              active={props.activeTab === item.id}
              collapsed={props.isCollapsed}
              icon={item.icon}
              label={props.t(item.labelKey)}
              onClick={() => props.onNavigate(item.id)}
            />
          ))}
        </div>
        <div className="sidebar-guide-section" data-sidebar-guide-anchor="activity">
          {primaryNav.slice(2)
            .filter((item) => props.projectClassificationFeatureEnabled || item.id !== "projects")
            .map((item) => (
              <SidebarNavButton
                key={item.id}
                active={props.activeTab === item.id}
                collapsed={props.isCollapsed}
                icon={item.icon}
                label={props.t(item.labelKey)}
                onClick={() => props.onNavigate(item.id)}
              />
            ))}
        </div>
      </nav>
      <div className="sidebar-nav-divider" aria-hidden="true" />
      {props.canOpenTeamsBeta && props.teamReviewVariant === "people-labeled" ? (
        <div className="nav-label nav-label--people">{props.t("nav.peopleAndTeams")}</div>
      ) : null}
      {props.teamReviewVariant !== "leaderboard-first" ? teamDestination : null}
      <SocialNavigation {...props} collapsed={props.isCollapsed} />
      {props.teamReviewVariant === "leaderboard-first" ? teamDestination : null}
    </>
  );
}

function LegacyTeamNavigation(props: SidebarNavigationProps) {
  if (!props.canOpenTeamsBeta) return null;
  return (
    <>
      <div className="nav-label nav-label--teams">
        <span>{props.t("team.nav.yourTeams")}</span>
        {!props.isCollapsed ? (
          <button
            type="button"
            className="nav-label__add"
            aria-label={props.t("team.nav.createOrJoin")}
            title={props.t("team.nav.createOrJoin")}
            onClick={() => props.onOpenTeamAction("add")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        ) : null}
      </div>
      <nav className="sidebar-nav sidebar-nav--teams" aria-label={props.t("team.nav.yourTeams")}>
        {props.teams.length === 0 ? (
          <SidebarNavButton
            active={props.activeTab === "team"}
            collapsed={props.isCollapsed}
            icon="team"
            label={props.t("team.nav.teams")}
            onClick={() => props.onNavigate("team")}
          />
        ) : props.teams.map((team) => {
          const isSelectedTeam = props.selectedTeam?.organization_id === team.organization_id;
          const expandedTeamId = props.teamNavExpandedId === undefined
            ? props.selectedTeam?.organization_id ?? null
            : props.teamNavExpandedId;
          const isExpandedTeam = expandedTeamId === team.organization_id;
          const toggleTeam = () => {
            if (props.isCollapsed) {
              props.onSelectTeam(team.organization_id);
              props.onNavigate("team");
              return;
            }
            props.onSelectTeam(team.organization_id);
            props.onTeamNavExpandedIdChange(isExpandedTeam ? null : team.organization_id);
          };
          return (
            <Fragment key={team.organization_id}>
              <div
                className="nav-item nav-item--team"
                role="button"
                tabIndex={0}
                aria-label={team.organization_name}
                aria-expanded={isExpandedTeam}
                onClick={toggleTeam}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleTeam();
                  }
                }}
              >
                <NavIcon type="team" />
                <span className="nav-item--team__name">{team.organization_name}</span>
                {props.isCollapsed ? (
                  <span className="nav-item__hover-label" aria-hidden="true">{team.organization_name}</span>
                ) : (
                  <>
                    <svg className={isExpandedTeam ? "team-nav-caret team-nav-caret--open" : "team-nav-caret"} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
                    {isSelectedTeam ? (
                      <button
                        type="button"
                        className="team-nav-more"
                        aria-label={props.t("team.nav.options")}
                        aria-haspopup="menu"
                        aria-expanded={props.teamNavMenuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          const anchorRect = event.currentTarget.getBoundingClientRect();
                          const sidebarRect = event.currentTarget.closest(".sidebar")?.getBoundingClientRect();
                          props.onTeamNavMenuPosChange({
                            left: Math.max(anchorRect.right, sidebarRect?.right ?? 0) + 8,
                            top: Math.max(8, anchorRect.top - 6),
                          });
                          props.onTeamNavMenuOpenChange((open) => !open);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {isExpandedTeam && !props.isCollapsed ? (
                <div className="sidebar-subnav">
                  <button
                    type="button"
                    aria-label={props.t("team.nav.dashboardsAria")}
                    className={props.activeTab === "team" && isSelectedTeam && props.teamSubView === "dashboards" ? "nav-item nav-item--sub active" : "nav-item nav-item--sub"}
                    aria-current={props.activeTab === "team" && isSelectedTeam && props.teamSubView === "dashboards" ? "page" : undefined}
                    onClick={() => {
                      props.onSelectTeam(team.organization_id);
                      props.onTeamSubViewChange("dashboards");
                      props.onNavigate("team");
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></svg>
                    <span>{props.t("team.nav.dashboards")}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={props.t("team.nav.projectsAria")}
                    className={props.activeTab === "team" && isSelectedTeam && props.teamSubView === "projects" ? "nav-item nav-item--sub active" : "nav-item nav-item--sub"}
                    aria-current={props.activeTab === "team" && isSelectedTeam && props.teamSubView === "projects" ? "page" : undefined}
                    onClick={() => {
                      props.onSelectTeam(team.organization_id);
                      props.onTeamSubViewChange("projects");
                      props.onNavigate("team");
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
                    <span>{props.t("team.nav.projects")}</span>
                  </button>
                </div>
              ) : null}
            </Fragment>
          );
        })}
        <AnchoredPresence>{props.teamNavMenuOpen && props.teamNavMenuPos && !props.isCollapsed ? (
          <div className="team-nav-menu" role="menu" aria-label={props.t("team.nav.options")} style={{ left: props.teamNavMenuPos.left, top: props.teamNavMenuPos.top }}>
            <button type="button" role="menuitem" onClick={() => props.onOpenTeamAction("invite")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.4" /><circle cx="8.8" cy="7.6" r="3.3" /><path d="M18.5 8v6M15.5 11h6" /></svg>
              {props.t("team.nav.inviteTeammate")}
            </button>
            <button type="button" role="menuitem" onClick={() => props.onOpenTeamAction("settings")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
              {props.t("team.nav.settings")}
            </button>
            <button type="button" role="menuitem" onClick={() => props.onOpenTeamAction("add")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              {props.t("team.nav.createOrJoin")}
            </button>
          </div>
        ) : null}</AnchoredPresence>
      </nav>
    </>
  );
}

function LegacyNavigation(props: SidebarNavigationProps) {
  return (
    <>
      <div className="sidebar-guide-section" data-sidebar-guide-anchor="dashboard">
        <div className="nav-label">{props.t("nav.group.dashboard")}</div>
        <nav className="sidebar-nav sidebar-nav--periods" aria-label={props.t("nav.dashboardViews")}>
          {dashboardPeriodOptions.map((item) => {
            const label = props.t(item.period === "Week" ? "nav.yourWeek" : "nav.yourDay");
            return (
              <SidebarNavButton
                key={item.period}
                active={props.activeTab === "dashboard" && props.dashPeriod === item.period}
                collapsed={props.isCollapsed}
                icon={item.period === "Week" ? "calendar" : "home"}
                label={label}
                onClick={() => props.onNavigate("dashboard", item.period)}
                variant="period"
              />
            );
          })}
          {props.canOpenAgentsBeta ? (
            <SidebarNavButton
              active={props.activeTab === "agents"}
              collapsed={props.isCollapsed}
              icon="agents"
              label={props.t("nav.yourAgents")}
              onClick={() => props.onNavigate("agents")}
              variant="period"
            />
          ) : null}
        </nav>
      </div>
      <div className="sidebar-guide-section" data-sidebar-guide-anchor="activity">
        <div className="nav-label">{props.t("nav.group.activity")}</div>
        <nav className="sidebar-nav" aria-label={props.t("nav.primaryNavigation")}>
          {activityNav
            .filter((item) => props.projectClassificationFeatureEnabled || item.id !== "projects")
            .map((item) => (
              <SidebarNavButton
                key={item.id}
                active={props.activeTab === item.id}
                collapsed={props.isCollapsed}
                icon={item.icon}
                label={props.t(item.labelKey)}
                onClick={() => props.onNavigate(item.id)}
              />
            ))}
        </nav>
      </div>
      <div className="nav-label">{props.t("nav.group.social")}</div>
      <SocialNavigation {...props} collapsed={props.isCollapsed} />
      <LegacyTeamNavigation {...props} />
    </>
  );
}

export function SidebarNavigation(props: SidebarNavigationProps) {
  return props.navigationRefreshEnabled
    ? <RefreshedNavigation {...props} />
    : <LegacyNavigation {...props} />;
}
