import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { SettingsSearch } from "./SettingsSearch";
import { AiMarkIcon } from "../../components/AiIcons";
import { PetIcon } from "../../components/PetIcon";
import { useLocalization } from "../localization/LocalizationContext";
import { useRef, useState } from "react";
import type { DevSettingsSubsection } from "./devSettingsNavigation";

export const DRIFTY_DISCORD_INVITE_URL = "https://discord.gg/NxcubTe2KD";

export type SettingsSection = "account" | "sync" | "general" | "pet" | "aiSetup" | "intelligence" | "memory" | "notifications" | "privacy" | "developer" | "dev";

/**
 * The AI settings sections that one AI setup panel renders: the classification
 * model ("aiSetup", kept as the id the AI status entry points already open), the
 * project-analysis (Intelligence) model, and Memory. They share connection keys,
 * so the panel stays mounted while the user moves between them.
 */
export type AiSettingsSection = Extract<SettingsSection, "aiSetup" | "intelligence" | "memory">;

export function isAiSettingsSection(section: SettingsSection): section is AiSettingsSection {
  return section === "aiSetup" || section === "intelligence" || section === "memory";
}

const SETTINGS_NAV_GROUPS = [
  {
    id: "personal",
    labelKey: "settings.sidebar.groupPersonal",
    items: [
      { id: "general", labelKey: "settings.section.general" },
      { id: "pet", labelKey: "settings.pet.title" },
      { id: "notifications", labelKey: "settings.section.notifications" },
      { id: "account", labelKey: "settings.section.account" },
      { id: "sync", labelKey: "settings.section.sync" },
      { id: "privacy", labelKey: "settings.section.privacy" },
    ],
  },
  {
    id: "ai",
    labelKey: "settings.sidebar.groupAi",
    items: [
      { id: "aiSetup", labelKey: "settings.ai.classification" },
      { id: "intelligence", labelKey: "settings.ai.intelligence" },
      { id: "memory", labelKey: "settings.ai.profile" },
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
    case "pet":
      return <PetIcon />;
    case "account":
      return (<svg {...props}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>);
    case "sync":
      // Lucide refresh-cw: https://lucide.dev/icons/refresh-cw
      return (<svg {...props}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>);
    case "aiSetup":
      return <AiMarkIcon />;
    case "intelligence":
      // Lucide lightbulb: https://lucide.dev/icons/lightbulb
      return (<svg {...props}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>);
    case "memory":
      // Lucide book-open: https://lucide.dev/icons/book-open
      return (<svg {...props}><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>);
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
  readonly activeDevSubsection?: DevSettingsSubsection;
  readonly isCollapsed: boolean;
  /** Sections holding a required item the user must act on, such as a missing OS permission. */
  readonly sectionsNeedingAttention?: ReadonlyArray<SettingsSection>;
  readonly showDevSection: boolean;
  /** Hide the project-analysis section when the project-classification feature is off. */
  readonly showIntelligenceSection?: boolean;
  readonly onBack: () => void;
  readonly onDevSubsectionChange?: (section: DevSettingsSubsection) => void;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly onSendFeedback: () => void;
};

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" />
      <path d="m3.8 6.6 8.2 5.8 8.2-5.8" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M22 20v-1a4 4 0 0 0-3-3.87" />
      <path d="M15.5 4.8a3.2 3.2 0 0 1 0 6.2" />
    </svg>
  );
}

export function SettingsSidebar({
  activeSection,
  isCollapsed,
  sectionsNeedingAttention = [],
  showDevSection,
  showIntelligenceSection = true,
  onBack,
  onSectionChange,
  onSendFeedback,
}: SettingsSidebarProps) {
  const visibleNavGroups = SETTINGS_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (item.id !== "dev" || showDevSection) && (item.id !== "intelligence" || showIntelligenceSection)),
    }))
    .filter((group) => group.items.length > 0);
  const { t } = useLocalization();
  const discordOpeningRef = useRef(false);
  const [discordOpening, setDiscordOpening] = useState(false);
  const [discordError, setDiscordError] = useState(false);

  async function openDiscordCommunity() {
    if (discordOpeningRef.current) return;

    discordOpeningRef.current = true;
    setDiscordOpening(true);
    setDiscordError(false);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(DRIFTY_DISCORD_INVITE_URL);
    } catch {
      setDiscordError(true);
    } finally {
      discordOpeningRef.current = false;
      setDiscordOpening(false);
    }
  }

  return (
    <aside className={isCollapsed ? "sidebar sidebar--settings sidebar--collapsed" : "sidebar sidebar--settings"} aria-label={t("settings.sidebar.label")}>
      <button type="button" className="settings-sidebar-back" onClick={onBack}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.8 3.8 5.6 8l4.2 4.2" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <SettingsSearch>
      <nav className="settings-nav" aria-label={t("settings.sidebar.sections")}>
        {visibleNavGroups.map((group) => {
          const groupLabel = t(group.labelKey);
          return (
            <div key={group.id} className="settings-nav-group" role="group" aria-labelledby={`settings-nav-group-${group.id}`}>
              <div id={`settings-nav-group-${group.id}`} className="nav-label">{groupLabel}</div>
              {group.items.map((item) => {
                const label = t(item.labelKey);
                const isActive = activeSection === item.id;
                const needsAttention = sectionsNeedingAttention.includes(item.id);
                const attentionId = `settings-nav-attention-${item.id}`;
                return (
                    <button key={item.id}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      aria-describedby={needsAttention ? attentionId : undefined}
                      className={`settings-nav-item${isActive ? " on" : ""}`}
                      data-rail-label={label.slice(0, 1)}
                      onClick={() => onSectionChange(item.id)}
                    >
                      <span className="settings-nav-item__icon" aria-hidden="true"><SettingsSectionIcon section={item.id} /></span>
                      <span className="settings-nav-item__label">{label}</span>
                      {needsAttention ? (
                        <>
                          <span className="settings-nav-item__attention" aria-hidden="true" />
                          <span id={attentionId} hidden>{t("settings.sidebar.needsAttention")}</span>
                        </>
                      ) : null}
                      {isCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
                    </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="settings-sidebar-links" role="group" aria-label={t("settings.sidebar.support")}>
        <button
          type="button"
          className="settings-nav-item settings-nav-item--link"
          onClick={onSendFeedback}
        >
          <span className="settings-nav-item__icon" aria-hidden="true"><FeedbackIcon /></span>
          <span className="settings-nav-item__label">{t("account.sendFeedback")}</span>
          {isCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{t("account.sendFeedback")}</span> : null}
        </button>
        <button
          type="button"
          className="settings-nav-item settings-nav-item--link"
          onClick={() => void openDiscordCommunity()}
          disabled={discordOpening}
          aria-busy={discordOpening}
        >
          <span className="settings-nav-item__icon" aria-hidden="true"><CommunityIcon /></span>
          <span className="settings-nav-item__label">{t("settings.sidebar.community")}</span>
          {!isCollapsed ? <ExternalLinkIcon className="settings-nav-item__external" /> : null}
          {isCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{t("settings.sidebar.community")}</span> : null}
        </button>
        {discordError ? <p className="settings-sidebar-links__error" role="alert">{t("settings.general.communityOpenFailed")}</p> : null}
      </div>
      </SettingsSearch>
    </aside>
  );
}
