import { useState } from "react";

import { AiPrivacyDetailsModal } from "./AiPrivacyDetailsModal";
import { AiDataSendingRows } from "./AiPrivacyReview";
import { AppExclusionSettingsRows } from "./AppExclusionSettingsRows";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { DriftySharingRows } from "./DriftySharingRows";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import "./PrivacySettingsSection.css";

type PrivacySettingsSectionProps = {
  readonly onHistoryDeleted?: () => Promise<void> | void;
  readonly deviceSyncEnabled?: boolean;
  readonly databasePath?: string | null;
  readonly todaySessionCount?: number;
};

/**
 * Privacy settings, built from the same blocks as General: a page title over a card of
 * flat rows, then one titled card per place the data can go. The AI group is the one
 * exception: it is long and rarely changed, so it is a single folded card whose header
 * carries only its title. Its rows are the same flat rows once it is open.
 *
 *   this page's title   what Drifty does not record
 *   AI data sending     what an AI provider receives, and what it never does (folded)
 *   Drifty data sharing what Drifty itself receives, and what is public
 *   data on this device where it is stored, and deleting history
 */
export function PrivacySettingsSection({
  onHistoryDeleted,
  deviceSyncEnabled = false,
  databasePath,
  todaySessionCount = 0,
}: PrivacySettingsSectionProps = {}) {
  const { t } = useLocalization();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false);

  return (
    <div className="settings-section settings-section--privacy">
      <div className="settings-block">
        <h3>{t("settings.section.privacy")}</h3>
        <AppExclusionSettingsRows deviceSyncEnabled={deviceSyncEnabled} />
      </div>
      <SettingsCollapsibleCard
        searchReveal="privacy-ai"
        settingId="settings.privacy.aiSending"
        subtitle={t("settings.privacy.aiSubtitle")}
        title={t("settings.privacy.aiSending")}
      >
        <AiDataSendingRows onOpenDetails={() => setAiDetailsOpen(true)} />
      </SettingsCollapsibleCard>
      <div className="settings-block" data-setting-id="settings.privacy.driftySharing">
        <h3>{t("settings.privacy.driftySharing")}</h3>
        <DriftySharingRows />
      </div>
      <div className="settings-block">
        <h3>{t("settings.privacy.localData")}</h3>
        <div data-setting-id="settings.data.database" className="settings-row">
          <div>
            <div className="lbl">{t("settings.data.database")}</div>
            <div className="desc">
              {t("settings.data.sessions")} · {t("settings.data.sessionsToday", { count: todaySessionCount })}
            </div>
          </div>
          <div className="ctrl ctrl--value ctrl--path" title={databasePath ?? undefined}>
            {databasePath ?? t("settings.data.unknown")}
          </div>
        </div>
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
        {aiDetailsOpen ? <AiPrivacyDetailsModal onClose={() => setAiDetailsOpen(false)} /> : null}
      </ModalPresence>
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
