import type { ReactNode, RefObject } from "react";
import type { ThemeMode } from "../features/settings/settingsStorage";
import type { NavIconType, TabId } from "./navigation";

export function NavIcon({ type }: { type: NavIconType }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 18, height: 18 };
  switch (type) {
    case "home":
      return (<svg {...props}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>);
    case "calendar":
      return (<svg {...props}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8 14h2M14 14h2M8 17h2" /></svg>);
    case "classification":
      return (<svg {...props}><path d="M4 5h16M4 12h10M4 19h14" /><circle cx="18" cy="12" r="2" /><circle cx="20" cy="19" r="2" /></svg>);
    case "history":
      return (<svg {...props}><path d="M12 8v5l3 2" /><path d="M5.6 5.6A9 9 0 1 1 3 12" /><path d="M3 4v5h5" /></svg>);
    case "trends":
      return (<svg {...props}><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></svg>);
    case "leaderboard":
      return (<svg {...props}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" /><path d="M7 5H5a2 2 0 0 0 2 4" /><path d="M17 5h2a2 2 0 0 1-2 4" /></svg>);
    case "settings":
      return (<svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
  }
}

export function WindowThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="window-theme-toggle"
      onClick={onToggle}
      aria-label="Toggle theme"
      aria-pressed={theme === "dark"}
      title={`Switch to ${nextTheme} mode`}
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
  const isRefreshing = loading && hasLoadedOnce;

  return (
    <main ref={contentRef} className={`content content--${activeTab}`}>
      <div className="refresh-indicator" data-active={isRefreshing} aria-live="polite" aria-hidden={!isRefreshing}>
        Refreshing tracker data&hellip;
      </div>
      {error ? <div className="notice notice--error">Error: {error}</div> : null}
      {children}
    </main>
  );
}
