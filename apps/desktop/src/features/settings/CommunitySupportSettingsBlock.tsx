import { useRef, useState } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import "./CommunitySupportSettingsBlock.css";

export const DRIFTY_DISCORD_INVITE_URL = "https://discord.gg/NxcubTe2KD";

type CommunitySupportSettingsBlockProps = {
  readonly onSendFeedback: () => void;
};

function CommunityIcon() {
  return (
    <svg className="community-support-settings__icon community-support-settings__icon--community" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M22 20v-1a4 4 0 0 0-3-3.87" />
      <path d="M15.5 4.8a3.2 3.2 0 0 1 0 6.2" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg className="community-support-settings__icon community-support-settings__icon--feedback" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" />
      <path d="m3.8 6.6 8.2 5.8 8.2-5.8" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="community-support-settings__external-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.2 2H2.8a.8.8 0 0 0-.8.8v6.4a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V7.8" />
      <path d="M6.4 2H10v3.6M10 2 5.4 6.6" />
    </svg>
  );
}

export function CommunitySupportSettingsBlock({ onSendFeedback }: CommunitySupportSettingsBlockProps) {
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
    <div className="settings-block settings-block--community-support">
      <h3>{t("settings.general.communitySupport")}</h3>
      <div className="settings-row">
        <div>
          <div className="lbl community-support-settings__label"><CommunityIcon />{t("settings.general.communityTitle")}</div>
          {discordError ? <p className="capture-recency capture-recency--error" role="alert">{t("settings.general.communityOpenFailed")}</p> : null}
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn community-support-settings__action" onClick={() => void openDiscordCommunity()} disabled={discordOpening} aria-busy={discordOpening}>
            <span>{discordOpening ? t("settings.general.communityOpening") : t("settings.general.communityAction")}</span>
            <ExternalLinkIcon />
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="lbl community-support-settings__label"><FeedbackIcon />{t("settings.general.feedbackTitle")}</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn community-support-settings__action" onClick={onSendFeedback}>{t("settings.general.feedbackAction")}</button>
        </div>
      </div>
    </div>
  );
}
