import type { ReactNode } from "react";
import type { DashboardPeriod } from "../features/dashboard/dashboardPeriods";
import type { LocalizationController } from "../features/localization/LocalizationContext";
import { NavIcon } from "./AppShell";
import { activityNav, dashboardPeriodOptions, flowNav, reviewNav, type NavIconType, type TabId } from "./navigation";

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
  /** Dev-server design review only: one more item at the end of the activity group. */
  readonly activityExtra?: ReactNode;
  readonly canOpenAgentsBeta: boolean;
  readonly canOpenProfileBeta: boolean;
  readonly canOpenTeamsBeta: boolean;
  readonly dashPeriod: DashboardPeriod;
  readonly isCollapsed: boolean;
  readonly navigationRefreshEnabled: boolean;
  readonly projectClassificationFeatureEnabled: boolean;
  readonly socialSection: "leaderboard" | "profile";
  readonly teamReviewVariant: SidebarTeamReviewVariant;
  readonly t: LocalizationController["t"];
  readonly onNavigate: (tabId: TabId, dashPeriod?: DashboardPeriod) => void;
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
        <div
          className="sidebar-guide-section"
          data-sidebar-guide-anchor="dashboard"
          role="group"
          aria-labelledby="sidebar-nav-group-flow"
        >
          <div id="sidebar-nav-group-flow" className="nav-label">{props.t("nav.group.flow")}</div>
          {flowNav
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
        <div
          className="sidebar-guide-section"
          data-sidebar-guide-anchor="activity"
          role="group"
          aria-labelledby="sidebar-nav-group-review"
        >
          <div id="sidebar-nav-group-review" className="nav-label">{props.t("nav.group.review")}</div>
          {reviewNav.map((item) => (
            <SidebarNavButton
              key={item.id}
              active={props.activeTab === item.id}
              collapsed={props.isCollapsed}
              icon={item.icon}
              label={props.t(item.labelKey)}
              onClick={() => props.onNavigate(item.id)}
            />
          ))}
          {props.activityExtra}
        </div>
      </nav>
      <div className="nav-label">{props.t("nav.group.social")}</div>
      {props.canOpenTeamsBeta && props.teamReviewVariant === "people-labeled" ? (
        <div className="nav-label nav-label--people">{props.t("nav.peopleAndTeams")}</div>
      ) : null}
      {props.teamReviewVariant !== "leaderboard-first" ? teamDestination : null}
      <SocialNavigation {...props} collapsed={props.isCollapsed} />
      {props.teamReviewVariant === "leaderboard-first" ? teamDestination : null}
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
          {props.activityExtra}
        </nav>
      </div>
      <div className="nav-label">{props.t("nav.group.social")}</div>
      <SocialNavigation {...props} collapsed={props.isCollapsed} />
      {props.canOpenTeamsBeta ? <TeamDestination {...props} collapsed={props.isCollapsed} /> : null}
    </>
  );
}

export function SidebarNavigation(props: SidebarNavigationProps) {
  return props.navigationRefreshEnabled
    ? <RefreshedNavigation {...props} />
    : <LegacyNavigation {...props} />;
}
