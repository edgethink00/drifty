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

type PrivacySettingsSectionProps = {
  readonly onHistoryDeleted?: () => Promise<void> | void;
  readonly deviceSyncEnabled?: boolean;
};

export function PrivacySettingsSection({ onHistoryDeleted, deviceSyncEnabled = false }: PrivacySettingsSectionProps = {}) {
  const { t } = useLocalization();
  const [aiSettings, setAiSettings] = useState<AiPrivacyRequestSettings>(() => readAiPrivacyRequestSettings());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

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
        <h3>{t("settings.privacy.review")}</h3>
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
