import { useSettingsSearch } from "./SettingsSearchContext";
import { useEffect, useState } from "react";

import {
  readLivingSoulForUser,
  type LivingSoulDocument,
} from "../classification/livingSoul";
import { useLocalization } from "../localization/LocalizationContext";
import type { WorkProfileSettings } from "../onboarding/onboardingState";
import { onboardingActivityLabel } from "../onboarding/onboardingOptionLabels";
import { AiSetupWorkProfileSection } from "./AiSetupWorkProfileSection";
import { MemoryPatternCards } from "./MemoryPatternCards";
import { MemorySuggestionList } from "./MemorySuggestionList";
import { useMemorySuggestions, type MemorySuggestionProvider } from "./useMemorySuggestions";
import { CollapsiblePanel } from "./CollapsiblePanel";

type AiSetupSupportSectionsProps = {
  readonly workProfileUserId: string;
  readonly savedWorkProfile: WorkProfileSettings;
  readonly workProfileDraft: WorkProfileSettings;
  readonly workProfileMessage: string | null;
  readonly workProfileSaving: boolean;
  readonly memorySnapshotVersion: number;
  readonly memorySuggestionProvider?: MemorySuggestionProvider | null;
  readonly onSaveWorkProfile: () => void | Promise<void>;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
};

type MemoryLoadState =
  | { readonly status: "loading"; readonly document: null }
  | { readonly status: "ready"; readonly document: LivingSoulDocument }
  | { readonly status: "empty" | "error"; readonly document: null };

export function AiSetupSupportSections({
  workProfileUserId,
  savedWorkProfile,
  workProfileDraft,
  workProfileMessage,
  workProfileSaving,
  memorySnapshotVersion,
  memorySuggestionProvider = null,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupSupportSectionsProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [editorExpanded, setEditorExpanded] = useState(false);
  const { request } = useSettingsSearch();
  useEffect(() => {
    if (request?.entry.reveal === "work-profile") setEditorExpanded(true);
  }, [request]);
  const [memory, setMemory] = useState<MemoryLoadState>({ status: "loading", document: null });

  useEffect(() => {
    let cancelled = false;
    setMemory({ status: "loading", document: null });
    void readLivingSoulForUser(workProfileUserId)
      .then((result) => {
        if (cancelled) return;
        if (result.state === "ready") {
          setMemory({ status: "ready", document: result.context.document });
          return;
        }
        // Stored-but-unreadable learning is an error, not an empty Memory.
        setMemory({ status: result.state === "absent" ? "empty" : "error", document: null });
      })
      .catch(() => {
        if (!cancelled) setMemory({ status: "error", document: null });
      });
    return () => {
      cancelled = true;
    };
  }, [memorySnapshotVersion, workProfileUserId]);

  // Another writer changed Memory after this view loaded: refresh in place so the
  // list keeps its notice and focus instead of dropping back to a loading state.
  const reloadMemory = () => {
    void readLivingSoulForUser(workProfileUserId)
      .then((result) => {
        if (result.state === "ready") setMemory({ status: "ready", document: result.context.document });
      })
      .catch(() => undefined);
  };

  const activityLabels = savedWorkProfile.workActivities.map((activity) => (
    onboardingActivityLabel(activity, effectiveLanguage)
  ));
  const hasProfile = activityLabels.length > 0 || savedWorkProfile.workDescription.trim().length > 0;
  const document = memory.document;
  const explicitPatternCount = document
    ? document.learned.workSupport.length + document.learned.drift.length + document.learned.ambiguities.length
    : 0;
  const contextualPatternCount = document?.contextualPriors.filter((prior) => prior.observedDays.length >= 3).length ?? 0;
  const suggestionsState = useMemorySuggestions({
    ownerId: workProfileUserId, provider: memorySuggestionProvider,
    language: effectiveLanguage === "ko" ? "ko" : "en", document,
  });
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  async function handleAcceptSuggestion(id: string) {
    setSuggestionBusy(true);
    setSuggestionNotice(null);
    const result = await suggestionsState.accept(id);
    if (result.ok) setMemory({ status: "ready", document: result.document });
    else {
      if (result.code === "memory_changed") reloadMemory();
      setSuggestionNotice(t(result.code === "memory_duplicate" ? "settings.ai.memorySuggestionDuplicate"
        : result.code === "memory_group_full" ? "settings.ai.memorySuggestionGroupFull"
          : result.code === "memory_limit" ? "settings.ai.memoryLimitReached"
            : result.code === "memory_changed" ? "settings.ai.memoryChangedElsewhere" : "settings.ai.memoryChangeFailed"));
    }
    setSuggestionBusy(false);
  }
  const editorPanelId = "ai-setup-memory-work-profile-editor";
  const editorButtonId = "ai-setup-memory-work-profile-edit";
  return (
    // A plain div with only aria-label is ignored by screen readers, so the
    // Memory overview carries a real region role.
    <section data-setting-id="settings.ai.memoryHeroTitle" className="ai-memory" aria-label={t("settings.ai.memoryOverviewAria")}>
      <section className="memory-section" aria-labelledby="ai-memory-profile-title">
        <div className="memory-section__head">
          <h4 id="ai-memory-profile-title" className="ai-setup-provider-heading">{t("settings.ai.memoryWorkContextLabel")}</h4>
        </div>
        <div className="memory-card memory-card--padded" data-setting-id="settings.ai.workProfile">
          <div className="memory-profile__bar">
            {editorExpanded ? null : hasProfile ? (
              <div className="memory-profile__body">
                {activityLabels.length > 0 ? (
                  <div className="ai-memory-tags" role="list" aria-label={t("settings.ai.selectedWorkActivities")}>
                    {activityLabels.map((activity) => <span key={activity} role="listitem">{activity}</span>)}
                  </div>
                ) : null}
                <p className="memory-profile__text">
                  {savedWorkProfile.workDescription.trim() || t("settings.ai.memoryProfileNoDescription")}
                </p>
              </div>
            ) : (
              <div className="memory-profile__body">
                <p className="memory-card__title">{t("settings.ai.memoryProfileEmptyTitle")}</p>
                <p className="memory-card__text">{t("settings.ai.memoryProfileEmptyDescription")}</p>
              </div>
            )}
            <button
              id={editorButtonId}
              type="button"
              className="settings-btn"
              aria-controls={editorPanelId}
              aria-expanded={editorExpanded}
              onClick={() => setEditorExpanded((current) => !current)}
            >
              {editorExpanded ? t("settings.ai.memoryCloseEditor") : t("common.edit")}
            </button>
          </div>
          <CollapsiblePanel
            contentClassName="ai-memory-editor"
            expanded={editorExpanded}
            id={editorPanelId}
            labelledBy={editorButtonId}
          >
            <AiSetupWorkProfileSection
              workProfileDraft={workProfileDraft}
              workProfileMessage={workProfileMessage}
              workProfileSaving={workProfileSaving}
              onSaveWorkProfile={onSaveWorkProfile}
              onWorkProfileDraftChange={onWorkProfileDraftChange}
            />
          </CollapsiblePanel>
        </div>
      </section>

      {suggestionsState.suggestions.length > 0 || suggestionsState.running ? (
        <section className="memory-section" aria-labelledby="ai-memory-suggested-title">
          <div className="memory-section__head">
            <h4 id="ai-memory-suggested-title" className="ai-setup-provider-heading">{t("settings.ai.memorySuggestionsLabel")}</h4>
            <div className="memory-section__aside">
              <span className="memory-section__count">
                {suggestionsState.running && suggestionsState.suggestions.length === 0
                  ? t("settings.ai.memorySuggestionsRunningShort")
                  : t("settings.ai.memorySuggestionCount", { count: suggestionsState.suggestions.length })}
              </span>
            </div>
          </div>
          {suggestionNotice ? <div className="memory-notice" role="status"><p>{suggestionNotice}</p></div> : null}
          {suggestionsState.suggestions.length > 0 ? (
            <MemorySuggestionList
              suggestions={suggestionsState.suggestions}
              busy={suggestionBusy}
              onAccept={(id) => void handleAcceptSuggestion(id)}
              onDecline={suggestionsState.decline}
            />
          ) : (
            <div className="memory-card memory-card--empty">
              <p className="memory-card__text">{t("settings.ai.memorySuggestionsRunning")}</p>
            </div>
          )}
        </section>
      ) : null}

      <section className="memory-section" aria-labelledby="ai-memory-learned-title">
        <div className="memory-section__head">
          <h4 id="ai-memory-learned-title" className="ai-setup-provider-heading">{t("settings.ai.memoryCorrectionsLabel")}</h4>
          <div className="memory-section__aside">
            {memory.status === "ready" && explicitPatternCount > 0 ? (
              <span className="memory-section__count">
                {t("settings.ai.memoryPatternCount", { count: explicitPatternCount })}
              </span>
            ) : null}
          </div>
        </div>
        {memory.status === "loading" ? (
          <div className="memory-card memory-card--empty">
            <p className="memory-card__text">{t("settings.ai.memoryLoading")}</p>
          </div>
        ) : memory.status === "error" ? (
          <div className="memory-card memory-card--empty">
            <p className="memory-card__title">{t("settings.ai.memoryUnreadableTitle")}</p>
            <p className="memory-card__text">{t("settings.ai.memoryUnreadableDescription")}</p>
          </div>
        ) : explicitPatternCount > 0 || Object.keys(document?.memoryControls?.rejectedPatterns ?? {}).length > 0 ? (
          <>
            {document ? <MemoryPatternCards key={workProfileUserId} ownerId={workProfileUserId} document={document}
              onChange={(next) => setMemory({ status: "ready", document: next })} onStale={reloadMemory} /> : null}
          </>
        ) : contextualPatternCount > 0 ? (
          // Repeated context exists but has no readable summary of its own, so
          // the count above must not sit over a "nothing learned yet" body.
          <div className="memory-card memory-card--empty">
            <p className="memory-card__text">
              {t("settings.ai.memoryContextOnlyDescription", { count: contextualPatternCount })}
            </p>
          </div>
        ) : (
          <div className="memory-card memory-card--empty">
            <p className="memory-card__title">{t("settings.ai.memoryPatternsEmptyTitle")}</p>
            <p className="memory-card__text">{t("settings.ai.memoryPatternsEmptyDescription")}</p>
          </div>
        )}
      </section>
    </section>
  );
}

