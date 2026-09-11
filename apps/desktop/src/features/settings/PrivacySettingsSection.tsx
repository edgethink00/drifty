import { useEffect, useState } from "react";

import { AI_EXCLUDED_FIELDS, AiPrivacyReview } from "./AiPrivacyReview";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { ModalPresence } from "../../components/ModalPresence";
import "./PrivacySettingsSection.css";
import { AppExclusionSettingsCard } from "./AppExclusionSettingsCard";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { useLocalization } from "../localization/LocalizationContext";
import { trackerClient } from "../../lib/api/trackerClient";
import {
  PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT,
  readProductAnalyticsEnabled,
  writeProductAnalyticsEnabled,
} from "../../lib/analytics/productAnalyticsPreference";

type PrivacySettingsSectionProps = {
  readonly onHistoryDeleted?: () => Promise<void> | void;
  readonly deviceSyncEnabled?: boolean;
  readonly databasePath?: string | null;
  readonly todaySessionCount?: number;
};

function formatReclaimedBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PrivacySettingsSection({
  onHistoryDeleted,
  deviceSyncEnabled = false,
  databasePath,
  todaySessionCount = 0,
}: PrivacySettingsSectionProps = {}) {
  const { t } = useLocalization();
  const [aiSettings, setAiSettings] = useState<AiPrivacyRequestSettings>(() => readAiPrivacyRequestSettings());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [iconCacheClearing, setIconCacheClearing] = useState(false);
  const [iconCacheCleared, setIconCacheCleared] = useState<string | null>(null);
  const [productAnalyticsEnabled, setProductAnalyticsEnabled] = useState(readProductAnalyticsEnabled);

  async function handleClearIconCache() {
    setIconCacheClearing(true);
    try {
      const { reclaimedBytes } = await trackerClient.clearIconCaches();
      setIconCacheCleared(formatReclaimedBytes(reclaimedBytes));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Failed to clear the icon cache.", message);
    } finally {
      setIconCacheClearing(false);
    }
  }

  useEffect(() => {
    const syncSettings = () => setAiSettings(readAiPrivacyRequestSettings());
    window.addEventListener("storage", syncSettings);
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    };
  }, []);

  useEffect(() => {
    const syncPreference = () => setProductAnalyticsEnabled(readProductAnalyticsEnabled());
    window.addEventListener("storage", syncPreference);
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, syncPreference);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, syncPreference);
    };
  }, []);

  const optionalValues = Object.values(aiSettings.optional);
  const optionalOnCount = optionalValues.filter(Boolean).length;

  return (
    <div className="settings-section settings-section--privacy">
      <div className="settings-block">
        <h3>{t("settings.section.privacy")}</h3>
        {/* These two are claims about product behavior, not settings. Drawn as
            settings-rows they read as controls the user failed to find, so they
            get their own shape and their full wording moves into one disclosure
            instead of standing permanently open above the only real toggle. */}
        <div className="privacy-claims">
          <p className="privacy-claims__lede">{t("settings.privacy.claimsLede")}</p>
          <ul className="privacy-claims__list">
            <li className="privacy-claims__item">
              <span aria-hidden="true" className="privacy-claims__check" />
              <span className="privacy-claims__text">{t("settings.privacy.rawTitle")}</span>
            </li>
            <li className="privacy-claims__item">
              <span aria-hidden="true" className="privacy-claims__check" />
              <span className="privacy-claims__text">{t("settings.privacy.cloudTitle")}</span>
            </li>
          </ul>
          <details className="privacy-claims__more">
            <summary className="privacy-claims__summary">
              <span>{t("settings.privacy.claimsMore")}</span>
              <span aria-hidden="true" className="privacy-claims__chevron" />
            </summary>
            <p className="privacy-claims__detail">{t("settings.privacy.rawDescription")}</p>
            <p className="privacy-claims__detail">{t("settings.privacy.cloudDescription")}</p>
          </details>
        </div>
        {/* The claims block above is not a settings-row, so this row is no longer the
            "h3 + .settings-row" that opens a card group and it lost its top edge.
            Naming it a group start restores the card it is supposed to be. */}
        <div className="settings-row settings-row--group-start">
          <label htmlFor="product-analytics-preference">
            <div className="lbl">{t("settings.privacy.productAnalyticsTitle")}</div>
            <div className="desc">{t("settings.privacy.productAnalyticsDescription")}</div>
          </label>
          <div className="ctrl">
            <input
              id="product-analytics-preference"
              className="drifty-checkbox"
              type="checkbox"
              role="switch"
              aria-label={t("settings.privacy.productAnalyticsTitle")}
              checked={productAnalyticsEnabled}
              onChange={(event) => {
                setProductAnalyticsEnabled(writeProductAnalyticsEnabled(event.currentTarget.checked));
              }}
            />
          </div>
        </div>
      </div>
      <SettingsCollapsibleCard searchReveal="privacy-ai" settingId="settings.privacy.aiSending"
        subtitle={t("settings.privacy.aiSubtitle")}
        summary={
          <>
            <span className={`chip${optionalOnCount > 0 ? " green" : ""}`}>{t("settings.privacy.optionalOn", { enabled: optionalOnCount, total: optionalValues.length })}</span>
            {/* Counted from the never-sent list itself. The previous chip asserted a
                bare "4" that matched nothing the user could open and count. */}
            <span className="chip gray">{t("settings.privacy.neverSentCount", { count: AI_EXCLUDED_FIELDS.length })}</span>
          </>
        }
        title={t("settings.privacy.aiSending")}
      >
        <AiPrivacyReview />
      </SettingsCollapsibleCard>
      <AppExclusionSettingsCard deviceSyncEnabled={deviceSyncEnabled} />
      <div className="settings-block">
        <h3>{t("settings.privacy.localData")}</h3>
        <div data-setting-id="settings.data.database" className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.database")}</div>
          </div>
          <div className="ctrl ctrl--value ctrl--path" title={databasePath ?? undefined}>
            {databasePath ?? t("settings.data.unknown")}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.sessions")}</div>
          </div>
          <div className="ctrl ctrl--value">{t("settings.data.sessionsToday", { count: todaySessionCount })}</div>
        </div>
        <div data-setting-id="settings.data.iconCache" className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.iconCache")}</div>
            <div className="desc">{t("settings.data.iconCacheDescription")}</div>
          </div>
          <div className="ctrl">
            <button
              className="settings-btn"
              type="button"
              disabled={iconCacheClearing}
              onClick={() => void handleClearIconCache()}
            >
              {iconCacheClearing ? t("settings.data.iconCacheClearing") : t("settings.data.iconCacheAction")}
            </button>
            {iconCacheCleared !== null ? (
              <span className="chip green">{t("settings.data.iconCacheCleared", { size: iconCacheCleared })}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="settings-block">
        <h3>{t("settings.privacy.danger")}</h3>
        <div data-setting-id="settings.privacy.deleteTitle" className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.deleteTitle")}</div>
            <div className="desc">{t("settings.privacy.deleteDescription")}</div>
          </div>
          <div className="ctrl">
            <button className="settings-btn danger" type="button" onClick={() => setDeleteModalOpen(true)}>
              {t("settings.privacy.deleteAction")}
            </button>
          </div>
        </div>
      </div>
      <ModalPresence>
        {deleteModalOpen ? (
        <DeleteHistoryModal
          onClose={() => setDeleteModalOpen(false)}
          deviceSyncEnabled={deviceSyncEnabled}
          onDeleted={async () => {
            await onHistoryDeleted?.();
          }}
        />
        ) : null}
      </ModalPresence>
    </div>
  );
}
