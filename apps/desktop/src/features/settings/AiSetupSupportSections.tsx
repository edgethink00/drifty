import { useSettingsSearch } from "./SettingsSearchContext";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
  readonly onSaveWorkProfile: () => Promise<boolean>;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
  readonly onResetWorkProfileDraft: () => void;
  /** My classifications, rendered as Memory's last section (fixed choices that apply ahead of AI). */
  readonly rulesSection?: ReactNode;
};

const PROFILE_SAVED_NOTICE_MS = 5000;

function sameWorkProfile(left: WorkProfileSettings, right: WorkProfileSettings): boolean {
  return left.workDescription.trim() === right.workDescription.trim()
    && left.workActivityOther.trim() === right.workActivityOther.trim()
    && left.workActivities.length === right.workActivities.length
    && left.workActivities.every((activity, index) => activity === right.workActivities[index]);
}

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
  onResetWorkProfileDraft,
  rulesSection = null,
}: AiSetupSupportSectionsProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [profileSavedNotice, setProfileSavedNotice] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const restoreEditFocusRef = useRef(false);
  // The draft lives in the parent panel and outlives this view, so a draft left
  // behind by switching sections must not resurface when the editor reopens.
  const resetDraftRef = useRef(onResetWorkProfileDraft);
  resetDraftRef.current = onResetWorkProfileDraft;
  const { request } = useSettingsSearch();
  useEffect(() => {
    resetDraftRef.current();
  }, []);
  // While mounted, a closed editor always holds the saved profile (every close
  // path resets or saves), so a search reveal must not wipe an open edit.
  useEffect(() => {
    if (request?.entry.reveal === "work-profile") setEditorExpanded(true);
  }, [request]);
  useEffect(() => {
    if (editorExpanded || !restoreEditFocusRef.current) return;
    restoreEditFocusRef.current = false;
    editButtonRef.current?.focus();
  }, [editorExpanded]);
  useEffect(() => {
    if (!profileSavedNotice) return;
    const timer = window.setTimeout(() => setProfileSavedNotice(false), PROFILE_SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [profileSavedNotice]);

  const openEditor = () => {
    onResetWorkProfileDraft();
    setProfileSavedNotice(false);
    setEditorExpanded(true);
    setEditorFocusRequest((current) => current + 1);
  };
  const closeEditor = () => {
    restoreEditFocusRef.current = true;
    setEditorExpanded(false);
  };
  const cancelEditor = () => {
    if (workProfileSaving) return;
    onResetWorkProfileDraft();
    closeEditor();
  };
  const saveEditor = async () => {
    if (!(await onSaveWorkProfile())) return;
    setProfileSavedNotice(true);
    closeEditor();
  };
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
  const workProfileChanged = !sameWorkProfile(workProfileDraft, savedWorkProfile);
  return (
    // A plain div with only aria-label is ignored by screen readers, so the
    // Memory overview carries a real region role.
    <section data-setting-id="settings.ai.memoryHeroTitle" className="ai-memory" aria-label={t("settings.ai.memoryOverviewAria")}>
      <section className="memory-section" aria-labelledby="ai-memory-profile-title">
        <div className="memory-section__head">
          <h4 id="ai-memory-profile-title" className="ai-setup-provider-heading">{t("settings.ai.memoryWorkContextLabel")}</h4>
          <div className="memory-section__aside">
            <span className="memory-section__count" role="status">
              {profileSavedNotice ? t("settings.ai.workProfileSaved") : ""}
            </span>
          </div>
        </div>
        <div className="memory-card memory-card--padded" data-setting-id="settings.ai.workProfile">
          {editorExpanded ? null : (
            <div className="memory-profile__bar">
              {hasProfile ? (
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
                ref={editButtonRef}
                id={editorButtonId}
                type="button"
                className="settings-btn"
                aria-controls={editorPanelId}
                onClick={openEditor}
              >
                {hasProfile ? t("common.edit") : t("settings.ai.memoryProfileAdd")}
              </button>
            </div>
          )}
          <CollapsiblePanel
            contentClassName="ai-memory-editor"
            expanded={editorExpanded}
            id={editorPanelId}
            labelledBy="ai-memory-profile-title"
          >
            <AiSetupWorkProfileSection
              workProfileDraft={workProfileDraft}
              workProfileMessage={workProfileMessage}
              workProfileSaving={workProfileSaving}
              canSave={workProfileChanged}
              focusRequest={editorFocusRequest}
              onSaveWorkProfile={saveEditor}
              onCancel={cancelEditor}
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
        <p className="memory-section__desc">{t("settings.ai.memoryCorrectionsHint")}</p>
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
      {rulesSection}
    </section>
  );
}

