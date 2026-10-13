import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type TabId } from "../../app/navigation";
import { AiMarkIcon, AiReclassifyIcon } from "../../components/AiIcons";
import { accessibilityClient } from "../../lib/api/accessibilityClient";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";

export interface CommandBarProps {
  readonly includeProjects: boolean;
  readonly navigationRefreshEnabled?: boolean;
  readonly onDismiss: () => void;
  readonly onNavigate: (tabId: TabId) => void;
  readonly onToggleTracking?: () => void;
  readonly isTrackingRunning?: boolean;
  readonly onToggleTheme?: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onNewProject?: () => void;
  readonly onReclassifyRecent?: () => void;
}

interface CommandItem {
  readonly id: string;
  readonly section: "navigation" | "actions" | "preferences";
  readonly label: string;
  readonly sub: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  readonly icon: string;
  readonly onSelect: () => void;
}

function renderCommandIcon(icon: string): ReactNode {
  switch (icon) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
          <path d="M8 14h2M14 14h2M8 17h2" />
        </svg>
      );
    case "agents":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <path d="M12.5 15H17" />
        </svg>
      );
    case "classification":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      );
    case "projects":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
      );
    case "trends":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "leaderboard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
          <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <line x1="1" x2="7" y1="14" y2="14" />
          <line x1="9" x2="15" y1="8" y2="8" />
          <line x1="17" x2="23" y1="16" y2="16" />
        </svg>
      );
    case "pause":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case "resume":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "reclassify":
      return <AiReclassifyIcon />;
    case "newProject":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
    case "theme":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      );
    case "ai":
      return <AiMarkIcon />;
    default:
      return null;
  }
}

export function CommandBar({
  includeProjects,
  navigationRefreshEnabled = false,
  onDismiss,
  onNavigate,
  onToggleTracking,
  isTrackingRunning = true,
  onToggleTheme,
  onOpenAiSettings,
  onNewProject,
  onReclassifyRecent,
}: CommandBarProps) {
  const { t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // The hints are macOS glyphs, and Windows installs no app menu, so none of
  // them maps to a key there. Showing them would advertise dead shortcuts.
  const showShortcuts = useMemo(() => accessibilityClient.detectHostPlatform() === "macos", []);

  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-command-search]" });
  useModalDismiss(onDismiss);
  const overlayDismiss = useOverlayDismiss(onDismiss);

  const allItems = useMemo<readonly CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: "nav-dashboard",
        section: "navigation",
        label: t(navigationRefreshEnabled ? "nav.calendar" : "nav.group.dashboard"),
        sub: t("command.dashboardSub"),
        shortcut: "⌘1",
        icon: navigationRefreshEnabled ? "calendar" : "dashboard",
        keywords: ["today", "calendar", "dashboard", "overview", "home", "오늘", "캘린더", "대시보드", "홈"],
        onSelect: () => onNavigate("dashboard"),
      },
    ];

    if (navigationRefreshEnabled) {
      items.push({
        id: "nav-agents",
        section: "navigation",
        label: t("nav.agents"),
        sub: t("command.agentsSub"),
        shortcut: "⌘2",
        icon: "agents",
        keywords: ["agents", "cli", "sessions", "에이전트", "세션"],
        onSelect: () => onNavigate("agents"),
      });
    } else {
      items.push({
        id: "nav-classification",
        section: "navigation",
        label: t("nav.classification"),
        sub: t("command.classificationSub"),
        shortcut: "⌘2",
        icon: "classification",
        keywords: ["activity", "categories", "classification", "분류", "활동", "카테고리"],
        onSelect: () => onNavigate("classification"),
      });
    }

    if (includeProjects) {
      items.push({
        id: "nav-projects",
        section: "navigation",
        label: t("nav.projects"),
        sub: t("command.projectsSub"),
        shortcut: "⌘3",
        icon: "projects",
        keywords: ["project", "time", "프로젝트", "작업"],
        onSelect: () => onNavigate("projects"),
      });
    }

    if (navigationRefreshEnabled) {
      items.push({
        id: "nav-classification",
        section: "navigation",
        label: t("nav.classification"),
        sub: t("command.classificationSub"),
        shortcut: includeProjects ? "⌘4" : "⌘3",
        icon: "classification",
        keywords: ["activity", "categories", "classification", "분류", "활동", "카테고리"],
        onSelect: () => onNavigate("classification"),
      });
    }

    items.push(
      {
        id: "nav-trends",
        section: "navigation",
        label: t("nav.trends"),
        sub: t("command.trendsSub"),
        shortcut: navigationRefreshEnabled
          ? (includeProjects ? "⌘5" : "⌘4")
          : (includeProjects ? "⌘4" : "⌘3"),
        icon: "trends",
        keywords: ["insights", "focus", "trends", "stats", "chart", "트렌드", "인사이트", "통계"],
        onSelect: () => onNavigate("trends"),
      },
      {
        id: "nav-history",
        section: "navigation",
        label: t("nav.history"),
        sub: t("command.historySub"),
        shortcut: navigationRefreshEnabled
          ? (includeProjects ? "⌘6" : "⌘5")
          : (includeProjects ? "⌘5" : "⌘4"),
        icon: "history",
        keywords: ["records", "history", "timeline", "log", "기록", "로그", "히스토리"],
        onSelect: () => onNavigate("history"),
      },
      {
        id: "nav-leaderboard",
        section: "navigation",
        label: t(navigationRefreshEnabled ? "nav.leaderboard" : "nav.group.social"),
        sub: t("command.socialSub"),
        shortcut: navigationRefreshEnabled
          ? (includeProjects ? "⌘7" : "⌘6")
          : (includeProjects ? "⌘6" : "⌘5"),
        icon: "leaderboard",
        keywords: ["social", "rank", "leaderboard", "global", "리더보드", "소셜", "랭킹", "순위"],
        onSelect: () => onNavigate("leaderboard"),
      },
      {
        id: "nav-settings",
        section: "navigation",
        label: t("common.settings"),
        sub: t("command.settingsSub"),
        shortcut: "⌘,",
        icon: "settings",
        keywords: ["preferences", "settings", "config", "설정", "환경설정"],
        onSelect: () => onNavigate("settings"),
      },
    );

    // Quick actions
    items.push({
      id: "action-toggle-tracking",
      section: "actions",
      label: isTrackingRunning ? t("command.action.pauseTracking") : t("command.action.resumeTracking"),
      sub: isTrackingRunning ? t("command.action.pauseTrackingSub") : t("command.action.resumeTrackingSub"),
      icon: isTrackingRunning ? "pause" : "resume",
      keywords: ["pause", "stop", "resume", "start", "tracking", "일시정지", "추적", "중지", "시작"],
      onSelect: () => {
        if (onToggleTracking) onToggleTracking();
        else onNavigate("dashboard");
      },
    });

    items.push({
      id: "action-reclassify",
      section: "actions",
      label: t("command.action.reclassify"),
      sub: t("command.action.reclassifySub"),
      icon: "reclassify",
      keywords: ["ai", "classify", "reclassify", "재분류", "인공지능", "자동분류"],
      onSelect: () => {
        if (onReclassifyRecent) onReclassifyRecent();
        else onNavigate("classification");
      },
    });

    if (includeProjects) {
      items.push({
        id: "action-new-project",
        section: "actions",
        label: t("command.action.newProject"),
        sub: t("command.action.newProjectSub"),
        icon: "newProject",
        keywords: ["new", "create", "project", "생성", "만들기", "프로젝트"],
        onSelect: () => {
          if (onNewProject) onNewProject();
          else onNavigate("projects");
        },
      });
    }

    // Preferences
    items.push(
      {
        id: "pref-toggle-theme",
        section: "preferences",
        label: t("command.action.toggleTheme"),
        sub: t("command.action.toggleThemeSub"),
        icon: "theme",
        keywords: ["theme", "dark", "light", "appearance", "테마", "다크모드", "라이트모드", "화면"],
        onSelect: () => {
          if (onToggleTheme) onToggleTheme();
          else onNavigate("settings");
        },
      },
      {
        id: "pref-ai-settings",
        section: "preferences",
        label: t("command.action.aiSettings"),
        sub: t("command.action.aiSettingsSub"),
        icon: "ai",
        keywords: ["ai", "model", "setup", "llm", "intelligence", "인공지능", "모델", "설정"],
        onSelect: () => {
          if (onOpenAiSettings) onOpenAiSettings();
          else onNavigate("settings");
        },
      },
    );

    return items;
  }, [
    includeProjects,
    navigationRefreshEnabled,
    isTrackingRunning,
    onNavigate,
    onNewProject,
    onOpenAiSettings,
    onReclassifyRecent,
    onToggleTheme,
    onToggleTracking,
    t,
  ]);

  const matchingItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allItems;
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.sub.toLowerCase().includes(query) ||
        item.keywords.some((k) => k.toLowerCase().includes(query)),
    );
  }, [allItems, searchQuery]);

  const sections = useMemo(() => {
    const navItems = matchingItems.filter((item) => item.section === "navigation");
    const actItems = matchingItems.filter((item) => item.section === "actions");
    const prefItems = matchingItems.filter((item) => item.section === "preferences");

    const result: Array<{ id: string; title: string; items: CommandItem[] }> = [];
    if (navItems.length > 0) {
      result.push({ id: "navigation", title: t("command.navigate"), items: navItems });
    }
    if (actItems.length > 0) {
      result.push({ id: "actions", title: t("command.section.actions"), items: actItems });
    }
    if (prefItems.length > 0) {
      result.push({ id: "preferences", title: t("command.section.preferences"), items: prefItems });
    }
    return result;
  }, [matchingItems, t]);

  useEffect(() => {
    const activeItem = matchingItems[selectedIndex];
    if (activeItem) {
      itemRefs.current[activeItem.id]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [selectedIndex, matchingItems]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((previous) => (matchingItems.length === 0 ? 0 : (previous + 1) % matchingItems.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((previous) =>
        matchingItems.length === 0 ? 0 : (previous - 1 + matchingItems.length) % matchingItems.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const current = matchingItems[selectedIndex];
      if (current) {
        current.onSelect();
      }
    }
  };

  return (
    <div className="cmd-overlay" {...overlayDismiss}>
      <div
        ref={dialogRef}
        aria-label={t("command.palette")}
        aria-modal="true"
        className="cmd-box modal-shell"
        data-modal-variant="utility"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="cmd-input-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            aria-label={t("command.search")}
            data-command-search
            placeholder={t("command.searchPlaceholder")}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button type="button" className="esc-key" onClick={onDismiss}>esc</button>
        </div>

        <div className="cmd-list" role="listbox" aria-label={t("command.palette")}>
          {sections.map((section) => (
            <div key={section.id} className="cmd-section" role="group" aria-label={section.title}>
              <div className="cmd-section-label">{section.title}</div>
              {section.items.map((item) => {
                const flatIndex = matchingItems.indexOf(item);
                const isSelected = flatIndex === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    ref={(element) => {
                      itemRefs.current[item.id] = element;
                    }}
                    aria-label={`${item.label} ${item.sub}`}
                    className={`cmd-item ${isSelected ? "cmd-item--selected" : ""}`}
                    data-selected={isSelected ? "true" : undefined}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                    role="button"
                  >
                    <span className="cmd-icon" aria-hidden="true">
                      {renderCommandIcon(item.icon)}
                    </span>
                    <span className="cmd-copy">
                      <span className="cmd-label">{item.label}</span>
                      <span className="cmd-sub">{item.sub}</span>
                    </span>
                    {showShortcuts && item.shortcut ? (
                      <kbd className="cmd-kbd" aria-hidden="true">{item.shortcut}</kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}

          {matchingItems.length === 0 ? (
            <div className="cmd-empty">
              <span className="cmd-empty__title">{t("command.empty")}</span>
              <span className="cmd-empty__hint">{t("command.emptyHint")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
