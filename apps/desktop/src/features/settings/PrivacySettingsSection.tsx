import { useEffect, useState } from "react";

import { AiPrivacyReview } from "./AiPrivacyReview";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { useLocalization } from "../localization/LocalizationContext";
import { trackerClient } from "../../lib/api/trackerClient";

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

  const optionalValues = Object.values(aiSettings.optional);
  const optionalOnCount = optionalValues.filter(Boolean).length;

  return (
    <div className="settings-section settings-section--privacy">
      <div className="settings-block">
        <h3>{t("settings.section.privacy")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.rawTitle")}</div>
            <div className="desc">{t("settings.privacy.rawDescription")}</div>
          </div>
          <div className="ctrl"><span className="chip green">{t("settings.privacy.rawChip")}</span></div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.cloudTitle")}</div>
            <div className="desc">{t("settings.privacy.cloudDescription")}</div>
          </div>
          <div className="ctrl"><span className="chip">{t("settings.privacy.aggregatesChip")}</span></div>
        </div>
      </div>
      <SettingsCollapsibleCard
        subtitle={t("settings.privacy.aiSubtitle")}
        summary={
          <>
            <span className={`chip${optionalOnCount > 0 ? " green" : ""}`}>{t("settings.privacy.optionalOn", { enabled: optionalOnCount, total: optionalValues.length })}</span>
            <span className="chip gray">{t("settings.privacy.lockedLocal")}</span>
            <span className="chip gray">{t("settings.privacy.keysLocal")}</span>
          </>
        }
        title={t("settings.privacy.aiSending")}
      >
        <AiPrivacyReview />
      </SettingsCollapsibleCard>
      <div className="settings-block">
        <h3>{t("settings.privacy.localData")}</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.database")}</div>
          </div>
          <div className="ctrl ctrl--value">{databasePath ?? t("settings.data.unknown")}</div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.sessions")}</div>
          </div>
          <div className="ctrl ctrl--value">{t("settings.data.sessionsToday", { count: todaySessionCount })}</div>
        </div>
        <div className="settings-row">
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
        <div className="settings-row">
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
      {deleteModalOpen ? (
        <DeleteHistoryModal
          onClose={() => setDeleteModalOpen(false)}
          deviceSyncEnabled={deviceSyncEnabled}
          onDeleted={async () => {
            await onHistoryDeleted?.();
          }}
        />
      ) : null}
    </div>
  );
}
