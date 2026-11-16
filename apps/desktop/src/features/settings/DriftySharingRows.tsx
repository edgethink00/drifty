import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useId, useState, type MouseEvent } from "react";

import { Toggle } from "../../components/Toggle";
import {
  PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT,
  readProductAnalyticsEnabled,
  writeProductAnalyticsEnabled,
} from "../../lib/analytics/productAnalyticsPreference";
import {
  CHAT_IMPROVEMENT_PREFERENCE_CHANGED_EVENT,
  CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY,
  readChatImprovementEnabled,
  writeChatImprovementEnabled,
} from "../chat/chatImprovementPreference";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { useSettingsSearch } from "./SettingsSearchContext";
import { useLocalization } from "../localization/LocalizationContext";

/** Compact footer entry: sharing details, the analytics preference and the
 * separate, default-off chat sharing preference. Opening or closing the
 * explanation never changes a saved transmission choice. */
export function DriftySharingRows() {
  const { effectiveLanguage, t } = useLocalization();
  const analyticsDescriptionId = useId();
  const chatDescriptionId = useId();
  const panelId = useId();
  const buttonId = useId();
  const { request } = useSettingsSearch();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (request?.entry.reveal === "privacy-sharing") setExpanded(true);
  }, [request]);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(readProductAnalyticsEnabled);
  const [chatImprovementEnabled, setChatImprovementEnabled] = useState(readChatImprovementEnabled);
  const [policyOpenFailed, setPolicyOpenFailed] = useState(false);
  const policyUrl = effectiveLanguage === "ko" ? "https://drifty.so/ko/privacy/" : "https://drifty.so/privacy/";

  useEffect(() => {
    const syncPreference = () => setAnalyticsEnabled(readProductAnalyticsEnabled());
    window.addEventListener("storage", syncPreference);
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, syncPreference);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, syncPreference);
    };
  }, []);

  useEffect(() => {
    const syncChat = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== CHAT_IMPROVEMENT_PREFERENCE_STORAGE_KEY) return;
      setChatImprovementEnabled(readChatImprovementEnabled());
    };
    window.addEventListener("storage", syncChat);
    window.addEventListener(CHAT_IMPROVEMENT_PREFERENCE_CHANGED_EVENT, syncChat);
    return () => {
      window.removeEventListener("storage", syncChat);
      window.removeEventListener(CHAT_IMPROVEMENT_PREFERENCE_CHANGED_EVENT, syncChat);
    };
  }, []);

  async function openPolicy(event: MouseEvent<HTMLAnchorElement>) {
    if (!isTauri()) return;
    event.preventDefault();
    setPolicyOpenFailed(false);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(policyUrl);
    } catch {
      setPolicyOpenFailed(true);
    }
  }

  return (
    <section className="privacy-sharing-details" data-setting-id="settings.privacy.driftySharing">
      <div className="privacy-sharing-details__links">
        <button type="button" className="settings-inline-link" aria-expanded={expanded} aria-controls={panelId} id={buttonId} onClick={() => setExpanded((current) => !current)}>
          {t("settings.privacy.sharingDetails")}
        </button>
        <a className="privacy-policy-link" href={policyUrl} target="_blank" rel="noreferrer" onClick={(event) => void openPolicy(event)}>
          {t("settings.privacy.policy")}<ExternalLinkIcon />
        </a>
      </div>
      {policyOpenFailed ? <p className="desc" role="alert">{t("settings.privacy.policyOpenFailed")}</p> : null}
      <CollapsiblePanel expanded={expanded} id={panelId} labelledBy={buttonId} contentClassName="privacy-sharing-details__body">
        <div data-setting-id="settings.privacy.productAnalyticsTitle" className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.productAnalyticsTitle")}</div>
            <div className="desc" id={analyticsDescriptionId}>{t("settings.privacy.productAnalyticsDetails")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              ariaDescribedBy={analyticsDescriptionId}
              ariaLabel={t("settings.privacy.productAnalyticsTitle")}
              checked={analyticsEnabled}
              onChange={(next) => setAnalyticsEnabled(writeProductAnalyticsEnabled(next))}
            />
          </div>
        </div>
        <div data-setting-id="settings.privacy.chatImprovementTitle" className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.chatImprovementTitle")}</div>
            <div className="desc" id={chatDescriptionId}>{t("settings.privacy.chatImprovementDetails")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              ariaDescribedBy={chatDescriptionId}
              ariaLabel={t("settings.privacy.chatImprovementTitle")}
              checked={chatImprovementEnabled}
              onChange={(next) => setChatImprovementEnabled(writeChatImprovementEnabled(next))}
            />
          </div>
        </div>
        <div data-setting-id="settings.privacy.publicScope" className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.rawTitle")}</div>
            <div className="desc">{t("settings.privacy.cloudDescription")}</div>
          </div>
        </div>
      </CollapsiblePanel>
    </section>
  );
}
