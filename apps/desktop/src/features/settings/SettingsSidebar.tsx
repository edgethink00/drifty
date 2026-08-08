import { useLocalization } from "../localization/LocalizationContext";

export type SettingsSection = "account" | "general" | "permissions" | "appearance" | "classification" | "aiSetup" | "notifications" | "privacy" | "developer" | "dev";

const SETTINGS_NAV_GROUPS = [
  {
    id: "app",
    labelKey: "settings.sidebar.groupApp",
    items: [
      { id: "general", labelKey: "settings.section.general" },
      { id: "permissions", labelKey: "settings.section.permissions" },
      { id: "appearance", labelKey: "settings.section.appearance" },
      { id: "notifications", labelKey: "settings.section.notifications" },
    ],
  },
  {
    id: "accountData",
    labelKey: "settings.sidebar.groupAccountData",
    items: [
      { id: "account", labelKey: "settings.section.account" },
      { id: "privacy", labelKey: "settings.section.privacy" },
    ],
  },
  {
    id: "ai",
    labelKey: "settings.sidebar.groupAi",
    items: [
      { id: "aiSetup", labelKey: "settings.section.aiSetup" },
      { id: "classification", labelKey: "settings.section.classification" },
    ],
  },
  {
    id: "advanced",
    labelKey: "settings.sidebar.groupAdvanced",
    items: [
      { id: "developer", labelKey: "settings.section.developer" },
      { id: "dev", labelKey: "common.dev" },
    ],
  },
] as const;

// Line icons matching the main NavIcon conventions in app/AppShell.tsx
// (viewBox 24, fill none, stroke currentColor, strokeWidth 1.8, round caps/joins)
// so the settings rail reads as one system with the primary sidebar.
function SettingsSectionIcon({ section }: { section: SettingsSection }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (section) {
    case "general":
      return (<svg {...props}><path d="M4 8h4M14 8h6" /><circle cx="11" cy="8" r="2" /><path d="M4 16h6M16 16h4" /><circle cx="13" cy="16" r="2" /></svg>);
    case "permissions":
      return (<svg {...props}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1.2" /></svg>);
    case "account":
      return (<svg {...props}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>);
    case "appearance":
      return (<svg {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></svg>);
    case "classification":
      return (<svg {...props}><path d="M4 5h16M4 12h10M4 19h14" /><circle cx="18" cy="12" r="2" /><circle cx="20" cy="19" r="2" /></svg>);
    case "aiSetup":
      return (<svg {...props}><path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6-4.6-1.7 4.6-1.7z" /><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>);
    case "notifications":
      return (<svg {...props}><path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.5 5.5 2 6H4c.5-.5 2-1.5 2-6" /><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0" /></svg>);
    case "privacy":
      return (<svg {...props}><path d="M12 3.5 5.5 6.2V11c0 4.4 2.9 7.4 6.5 9 3.6-1.6 6.5-4.6 6.5-9V6.2z" /><path d="M9.2 12l2 2 3.4-3.6" /></svg>);
    case "developer":
      return (<svg {...props}><path d="M8.5 8 4.5 12l4 4" /><path d="M15.5 8l4 4-4 4" /><path d="M13.4 5l-2.8 14" /></svg>);
    case "dev":
      return (<svg {...props}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4.2" /><path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>);
  }
}

type SettingsSidebarProps = {
  readonly activeSection: SettingsSection;
  readonly isCollapsed: boolean;
  readonly showDevSection: boolean;
  readonly onBack: () => void;
  readonly onSectionChange: (section: SettingsSection) => void;
};

export function SettingsSidebar({ activeSection, isCollapsed, showDevSection, onBack, onSectionChange }: SettingsSidebarProps) {
  const visibleNavGroups = SETTINGS_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== "dev" || showDevSection),
    }))
    .filter((group) => group.items.length > 0);
  const { t } = useLocalization();

  return (
    <aside className={isCollapsed ? "sidebar sidebar--settings sidebar--collapsed" : "sidebar sidebar--settings"} aria-label={t("settings.sidebar.label")}>
      <button type="button" className="settings-sidebar-back" onClick={onBack}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.8 3.8 5.6 8l4.2 4.2" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <div className="settings-sidebar-heading">
        <strong>{t("common.settings")}</strong>
      </div>

      <nav className="settings-nav" aria-label={t("settings.sidebar.sections")}>
        {visibleNavGroups.map((group) => {
          const groupLabel = t(group.labelKey);
          return (
            <div key={group.id} className="settings-nav-group" role="group" aria-label={groupLabel}>
              {group.items.map((item) => {
                const label = t(item.labelKey);
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    className={`settings-nav-item${isActive ? " on" : ""}`}
                    data-rail-label={label.slice(0, 1)}
                    onClick={() => onSectionChange(item.id)}
                  >
                    <span className="settings-nav-item__icon" aria-hidden="true"><SettingsSectionIcon section={item.id} /></span>
                    <span className="settings-nav-item__label">{label}</span>
                    {isCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
