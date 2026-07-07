export type AiSetupPanelTab = "providers" | "intelligence" | "profile";

const AI_SETUP_PANEL_TABS = [
  { id: "providers", label: "Classification", icon: "providers" },
  { id: "intelligence", label: "Intelligence", icon: "intelligence" },
  { id: "profile", label: "Profile & info", icon: "profile" },
] as const satisfies readonly {
  readonly id: AiSetupPanelTab;
  readonly label: string;
  readonly icon: "providers" | "intelligence" | "profile";
}[];

type AiSetupPanelTabsProps = {
  readonly activeTab: AiSetupPanelTab;
  readonly onChange: (tab: AiSetupPanelTab) => void;
  /** Hide the Intelligence tab when the project-classification preview is off. */
  readonly showIntelligenceTab?: boolean;
};

export function AiSetupPanelTabs({ activeTab, onChange, showIntelligenceTab = true }: AiSetupPanelTabsProps) {
  const tabs = AI_SETUP_PANEL_TABS.filter((tab) => showIntelligenceTab || tab.id !== "intelligence");
  return (
    <div className="ai-setup-panel-tabs" role="tablist" aria-label="AI setup sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`ai-setup-panel-tab-${tab.id}`}
          className={`ai-setup-panel-tab${activeTab === tab.id ? " is-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          <AiSetupPanelTabIcon icon={tab.icon} />
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function AiSetupPanelTabIcon({ icon }: { readonly icon: "providers" | "intelligence" | "profile" }) {
  switch (icon) {
    case "providers":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M4 5.5h12M4 10h12M4 14.5h12" />
          <path d="M7 3.8v3.4M13 8.3v3.4M9.5 12.8v3.4" />
        </svg>
      );
    case "intelligence":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 2.5a5 5 0 0 1 3 9v2.2H7V11.5a5 5 0 0 1 3-9Z" />
          <path d="M8 16.2h4M8.6 18h2.8" />
        </svg>
      );
    case "profile":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M6.2 4.2h7.6v11.6H6.2z" />
          <path d="M8 7.2h4M8 10h4M8 12.8h2.6" />
        </svg>
      );
    default:
      return assertNever(icon);
  }
}

class AiSetupPanelTabError extends Error {
  constructor(readonly icon: string) {
    super(`Unhandled AI setup panel tab icon: ${icon}`);
    this.name = "AiSetupPanelTabError";
  }
}

function assertNever(value: never): never {
  throw new AiSetupPanelTabError(String(value));
}
