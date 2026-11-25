import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { SettingsSearch } from "./SettingsSearch";
import { AiMarkIcon } from "../../components/AiIcons";
import { PetIcon } from "../../components/PetIcon";
import { useLocalization } from "../localization/LocalizationContext";
import { useRef, useState } from "react";
import type { DevSettingsSubsection } from "./devSettingsNavigation";

export const DRIFTY_DISCORD_INVITE_URL = "https://discord.gg/NxcubTe2KD";

export type SettingsSection = "account" | "sync" | "general" | "pet" | "aiSetup" | "intelligence" | "memory" | "notifications" | "privacy" | "developer" | "dev";

/** Shared AI connection, its legacy Intelligence deep link, and Memory. */
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
      { id: "aiSetup", labelKey: "settings.ai.connectionTitle" },
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
// Each glyph is drawn to the same optical size rather than the same box: the
// area its outline encloses is about 11.3px across at the 16px slot, the median
// of the main sidebar icons. Open shapes (the code brackets) reach the box edge
// instead. Mixing stock and hand-drawn glyphs at their native sizes made the
// book read twice as large as the brackets.
function SettingsSectionIcon({ section }: { section: SettingsSection }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (section) {
    case "general":
      return (<svg {...props}><path d="M2.5 7.2h4.7M14.4 7.2h7.1" /><circle cx="10.8" cy="7.2" r="2.4" /><path d="M2.5 16.8h7.1M16.8 16.8h4.7" /><circle cx="13.2" cy="16.8" r="2.4" /></svg>);
    case "pet":
      return <PetIcon />;
    case "account":
      // The one-person form of the Community glyph below, so both read as the same figure.
      return (<svg {...props}><circle cx="12" cy="6.7" r="3.8" /><path d="M21 21.1v-1.2a4.8 4.8 0 0 0-4.8-4.8H7.8a4.8 4.8 0 0 0-4.8 4.8v1.2" /></svg>);
    case "sync":
      // Lucide refresh-cw (https://lucide.dev/icons/refresh-cw), drawn at 89%.
      return (<svg {...props}><path d="M4 12a8 8 0 0 1 8-8 8.7 8.7 0 0 1 6 2.4L20 8.4" /><path d="M20 4v4.4h-4.4" /><path d="M20 12a8 8 0 0 1-8 8 8.7 8.7 0 0 1-6-2.4L4 15.6" /><path d="M8.4 15.6H4V20" /></svg>);
    case "aiSetup":
      return <AiMarkIcon />;
    case "intelligence":
      // Lucide lightbulb: https://lucide.dev/icons/lightbulb
      return (<svg {...props}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>);
    case "memory":
      // Lucide book-open (https://lucide.dev/icons/book-open), drawn at 84%.
      return (<svg {...props}><path d="M12 7.9v11.6" /><path d="M4.5 17a.8.8 0 0 1-.8-.8V5.3a.8.8 0 0 1 .8-.8h4.1a3.4 3.4 0 0 1 3.4 3.4 3.4 3.4 0 0 1 3.4-3.4h4.1a.8.8 0 0 1 .8.8v10.9a.8.8 0 0 1-.8.8h-5a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0-2.5-2.5z" /></svg>);
    case "notifications":
      return (<svg {...props}><path d="M5.4 8.7a6.6 6.6 0 0 1 13.2 0c0 5 1.7 6.1 2.2 6.7H3.2c.5-.6 2.2-1.7 2.2-6.7" /><path d="M10 19.8a2.1 2.1 0 0 0 4 0" /></svg>);
    case "privacy":
      return (<svg {...props}><path d="M12 2 4.3 5.2v5.7c0 5.2 3.4 8.8 7.7 10.6 4.3-1.8 7.7-5.4 7.7-10.6V5.2z" /><path d="M8.7 12l2.4 2.4 4-4.3" /></svg>);
    case "developer":
      // Lucide code-xml: https://lucide.dev/icons/code-xml
      return (<svg {...props}><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>);
    case "dev":
      // Lucide flask-conical (https://lucide.dev/icons/flask-conical), drawn at 97%:
      // Dev holds experiments, flags and previews. The sun it replaced matched the theme toggle.
      return (<svg {...props}><path d="M13.9 2.3v5.8a1.9 1.9 0 0 0 .2.9l5.4 9.8A1.9 1.9 0 0 1 17.8 21.7H6.2a1.9 1.9 0 0 1-1.7-2.9l5.4-9.8a1.9 1.9 0 0 0 .2-.9V2.3" /><path d="M6.6 14.9h10.8" /><path d="M8.6 2.3h6.8" /></svg>);
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
  /** Set while the public repository is open to this account: a GitHub row under Community. */
  readonly onOpenGitHub?: () => void;
};

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" />
      <path d="m3.8 6.6 8.2 5.8 8.2-5.8" />
    </svg>
  );
}

function GitHubMarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
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
  onBack,
  onSectionChange,
  onSendFeedback,
  onOpenGitHub,
}: SettingsSidebarProps) {
  const visibleNavGroups = SETTINGS_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (item.id !== "dev" || showDevSection)),
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6 9 12l6 6" />
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
                const isActive = activeSection === item.id || (activeSection === "intelligence" && item.id === "aiSetup");
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
        {onOpenGitHub ? (
          <button type="button" className="settings-nav-item settings-nav-item--link settings-nav-item--github" onClick={onOpenGitHub}>
            <span className="settings-nav-item__icon" aria-hidden="true"><GitHubMarkIcon /></span>
            <span className="settings-nav-item__label">GitHub</span>
            {!isCollapsed ? <ExternalLinkIcon className="settings-nav-item__external" /> : null}
            {isCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">GitHub</span> : null}
          </button>
        ) : null}
        {discordError ? <p className="settings-sidebar-links__error" role="alert">{t("settings.general.communityOpenFailed")}</p> : null}
      </div>
      </SettingsSearch>
    </aside>
  );
}
