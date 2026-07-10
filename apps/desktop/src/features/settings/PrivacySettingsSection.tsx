import { useEffect, useState } from "react";

import { AiPrivacyReview } from "./AiPrivacyReview";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";

type PrivacySettingsSectionProps = {
  readonly onHistoryDeleted?: () => Promise<void> | void;
  readonly deviceSyncEnabled?: boolean;
};

export function PrivacySettingsSection({ onHistoryDeleted, deviceSyncEnabled = false }: PrivacySettingsSectionProps = {}) {
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
        <h3>Privacy review</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Raw tracking history is not published</div>
            <div className="desc">Leaderboard and profile features publish aggregates only. AI classification may send minimized activity fields to your selected provider for a request, but raw app, site, window, and session history stays out of public surfaces.</div>
          </div>
          <div className="ctrl"><span className="chip green">Raw history local</span></div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Optional cloud features are explicit</div>
            <div className="desc">If you connect Drifty Cloud and join the leaderboard, Drifty publishes your public profile card plus a rolling 7 day focus total, refreshed about once an hour. Other participants can see roughly which hours you're active, but raw tracking history is never published there.</div>
          </div>
          <div className="ctrl"><span className="chip">Aggregates only</span></div>
        </div>
      </div>
      <SettingsCollapsibleCard
        subtitle="What Drifty can send for AI classification"
        summary={
          <>
            <span className={`chip${optionalOnCount > 0 ? " green" : ""}`}>{optionalOnCount} of {optionalValues.length} optional on</span>
            <span className="chip gray">4 locked local</span>
            <span className="chip gray">Keys stay local</span>
          </>
        }
        title="AI data sending"
      >
        <AiPrivacyReview />
      </SettingsCollapsibleCard>
      <div className="settings-block">
        <h3>Danger zone</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Delete tracked history</div>
            <div className="desc">Permanently remove local activity data for a time range. This cannot be undone.</div>
          </div>
          <div className="ctrl">
            <button className="settings-btn danger" type="button" onClick={() => setDeleteModalOpen(true)}>
              Delete history…
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
