import type { ReactNode, RefObject } from "react";
import type { ThemeMode } from "../features/settings/settingsStorage";
import type { NavIconType, TabId } from "./navigation";
import { useLocalization } from "../features/localization/LocalizationContext";

export function NavIcon({ type }: { type: NavIconType }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 18, height: 18 };
  switch (type) {
    case "home":
      return (<svg {...props}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>);
    case "calendar":
      return (<svg {...props}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8 14h2M14 14h2M8 17h2" /></svg>);
    case "agents":
      // A terminal prompt: the machine-side of the day, next to home and calendar.
      return (<svg {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M12.5 15H17" /></svg>);
    case "classification":
      return (<svg {...props}><path d="M4 5h16M4 12h10M4 19h14" /><circle cx="18" cy="12" r="2" /><circle cx="20" cy="19" r="2" /></svg>);
    case "projects":
      // Shifted down 2 units so the stacked layers sit on the same optical
      // midline as Classification/Trends instead of hugging the top of the 24 box.
      return (<svg {...props}><path d="M12 5 3 10l9 5 9-5-9-5Z" /><path d="M3 15l9 5 9-5" /><path d="M3 10v5m18-5v5" /></svg>);
    case "history":
      return (<svg {...props}><path d="M12 8v5l3 2" /><path d="M5.6 5.6A9 9 0 1 1 3 12" /><path d="M3 4v5h5" /></svg>);
    case "trends":
      return (<svg {...props}><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></svg>);
    case "leaderboard":
      return (<svg {...props}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" /><path d="M7 5H5a2 2 0 0 0 2 4" /><path d="M17 5h2a2 2 0 0 1-2 4" /></svg>);
    case "profile":
      return (<svg {...props}><circle cx="12" cy="8" r="3.4" /><path d="M5 20v-.6a5.5 5.5 0 0 1 5.5-5.5h3a5.5 5.5 0 0 1 5.5 5.5v.6" /></svg>);
    case "social":
      return (<svg {...props}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6" /></svg>);
    case "team":
      return (<svg {...props}><path d="M17 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9.5" cy="8" r="3.2" /><path d="M22 20v-1a4 4 0 0 0-3-3.87" /><path d="M15.5 4.8a3.2 3.2 0 0 1 0 6.2" /></svg>);
    case "settings":
      return (<svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
  }
}

export function WindowThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const { t } = useLocalization();

  return (
    <button
      type="button"
      className="window-theme-toggle"
      onClick={onToggle}
      aria-label={t("shell.toggleTheme")}
      aria-pressed={theme === "dark"}
      title={t(theme === "dark" ? "shell.switchToLightMode" : "shell.switchToDarkMode")}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A8.2 8.2 0 1 1 11.2 3a6.4 6.4 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

type MainContentShellProps = {
  activeTab: TabId;
  loading: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
  contentRef?: RefObject<HTMLElement>;
  children: ReactNode;
};

export function MainContentShell({ activeTab, loading, hasLoadedOnce, error, contentRef, children }: MainContentShellProps) {
  const { t } = useLocalization();
  const isRefreshing = loading && hasLoadedOnce;

  return (
    <main ref={contentRef} className={`content content--${activeTab}`}>
      <div className="refresh-indicator" data-active={isRefreshing} aria-live="polite" aria-hidden={!isRefreshing}>
        {t("shell.refreshingTracker")}
      </div>
      {error ? <div className="notice notice--error" role="alert">{t("shell.errorPrefix")} {error}</div> : null}
      {children}
    </main>
  );
}
