export type SettingsSection = "general" | "classification" | "aiSetup" | "notifications" | "privacy" | "data" | "dev";

const SETTINGS_NAV_ITEMS = [
  { id: "general", label: "General" },
  { id: "classification", label: "Classification" },
  { id: "aiSetup", label: "AI setup" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Data & Export" },
  { id: "dev", label: "Dev" },
] satisfies ReadonlyArray<{ id: SettingsSection; label: string }>;

type SettingsSidebarProps = {
  readonly activeSection: SettingsSection;
  readonly isCollapsed: boolean;
  readonly showDevSection: boolean;
  readonly onBack: () => void;
  readonly onSectionChange: (section: SettingsSection) => void;
};

export function SettingsSidebar({ activeSection, isCollapsed, showDevSection, onBack, onSectionChange }: SettingsSidebarProps) {
  const visibleNavItems = showDevSection ? SETTINGS_NAV_ITEMS : SETTINGS_NAV_ITEMS.filter((item) => item.id !== "dev");

  return (
    <aside className={isCollapsed ? "sidebar sidebar--settings sidebar--collapsed" : "sidebar sidebar--settings"} aria-label="Settings navigation">
      <button type="button" className="settings-sidebar-back" onClick={onBack}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.8 3.8 5.6 8l4.2 4.2" />
        </svg>
        <span>Back</span>
      </button>

      <div className="settings-sidebar-heading">
        <span>Account</span>
        <strong>Settings</strong>
      </div>

      <nav className="settings-nav" aria-label="Settings sections">
        {visibleNavItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${activeSection === item.id ? " on" : ""}`}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
