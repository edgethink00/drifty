import { useState } from "react";
import type { DeleteHistoryRangeResult } from "@drifty/domain";

import { AiPrivacyDetailsModal } from "./AiPrivacyDetailsModal";
import { AiDataSendingRows } from "./AiPrivacyReview";
import { ExclusionSettingsRows } from "./AppExclusionSettingsRows";
import { HistoryDeletionNotice } from "./HistoryDeletionNotice";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { DriftySharingRows } from "./DriftySharingRows";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { ModalPresence } from "../../components/ModalPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { PrivateWindowSettingsRow } from "../feedback-requests/FeedbackRequestSettingsRows";
import "./PrivacySettingsSection.css";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { ScreenRecordingDataRow } from "./ScreenContextSettings";
import { ScreenAiConsentSettings } from "./ScreenAiConsentSettings";

type PrivacySettingsSectionProps = {
  readonly onHistoryDeleted?: () => Promise<void> | void;
  readonly deviceSyncEnabled?: boolean;
  readonly screenContextClient?: ScreenContextClient;
  /** The selected Drifty local model, when screen text could be offered to AI. */
  readonly screenAiModelId?: string | null;
  readonly onOpenAiSettings?: () => void;
};

/** Everyday privacy controls stay visible; sharing explanations and the analytics
 * preference live in the small footer details, without changing saved choices. */
export function PrivacySettingsSection({
  onHistoryDeleted,
  deviceSyncEnabled = false,
  screenContextClient,
  screenAiModelId = null,
  onOpenAiSettings,
}: PrivacySettingsSectionProps = {}) {
  const { t } = useLocalization();
  const [deletionResult, setDeletionResult] = useState<DeleteHistoryRangeResult | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false);

  return (
    <div className="settings-section settings-section--privacy">
      <div className="settings-block">
        <h3>{t("settings.section.privacy")}</h3>
        <ExclusionSettingsRows deviceSyncEnabled={deviceSyncEnabled} />
        <PrivateWindowSettingsRow />
        {/* What may leave for AI classification folds into the same card as
            what is never recorded, as its last row. */}
        <SettingsCollapsibleCard
          searchReveal="privacy-ai"
          settingId="settings.privacy.aiSending"
          subtitle={t("settings.privacy.aiSubtitle")}
          title={t("settings.privacy.aiSending")}
          variant="row"
        >
          <AiDataSendingRows onOpenDetails={() => setAiDetailsOpen(true)} />
        </SettingsCollapsibleCard>
      </div>
      {screenContextClient?.isDesktop() && screenAiModelId ? (
        <ScreenAiConsentSettings key={screenAiModelId} client={screenContextClient} expectedModelId={screenAiModelId} onOpenAiSettings={onOpenAiSettings} />
      ) : null}
      <div className="settings-block">
        <h3>{t("settings.privacy.localData")}</h3>
        <div data-setting-id="settings.privacy.deleteTitle" className="settings-row">
          <div>
            <div className="lbl">{t("settings.privacy.deleteTitle")}</div>
            <div className="desc">{t("settings.privacy.deleteDescription")}</div>
          </div>
          <div className="ctrl">
            <button className="settings-btn danger" type="button" onClick={() => { setDeletionResult(null); setDeleteModalOpen(true); }}>
              {t("settings.privacy.deleteAction")}
            </button>
          </div>
        </div>
        {screenContextClient ? <ScreenRecordingDataRow client={screenContextClient} /> : null}
      </div>
      <DriftySharingRows />
      {deletionResult ? <HistoryDeletionNotice result={deletionResult} onDismiss={() => setDeletionResult(null)} /> : null}
      <ModalPresence>
        {aiDetailsOpen ? <AiPrivacyDetailsModal onClose={() => setAiDetailsOpen(false)} /> : null}
      </ModalPresence>
      <ModalPresence>
        {deleteModalOpen ? (
        <DeleteHistoryModal
          onClose={() => setDeleteModalOpen(false)}
          onCompleted={(result) => { setDeletionResult(result); setDeleteModalOpen(false); }}
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
