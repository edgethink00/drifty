import { useEffect, useMemo, useState } from "react";

import { formatRelativeTime } from "../../lib/formatting";
import {
  readLivingSoulForUser,
  type LivingSoulDocument,
  type LivingSoulPattern,
} from "../classification/livingSoul";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { WorkProfileSettings } from "../onboarding/onboardingState";
import { onboardingActivityLabel } from "../onboarding/onboardingOptionLabels";
import { AiSetupWorkProfileSection } from "./AiSetupWorkProfileSection";
import { CollapsiblePanel } from "./CollapsiblePanel";

type AiSetupSupportSectionsProps = {
  readonly workProfileUserId: string;
  readonly savedWorkProfile: WorkProfileSettings;
  readonly workProfileDraft: WorkProfileSettings;
  readonly workProfileMessage: string | null;
  readonly workProfileSaving: boolean;
  readonly memorySnapshotVersion: number;
  readonly onSaveWorkProfile: () => void | Promise<void>;
  readonly onWorkProfileDraftChange: (value: WorkProfileSettings) => void;
};

type MemoryLoadState =
  | { readonly status: "loading"; readonly document: null }
  | { readonly status: "ready"; readonly document: LivingSoulDocument }
  | { readonly status: "empty" | "error"; readonly document: null };

type PatternPreview = {
  readonly kind: "work" | "drift" | "ambiguity";
  readonly pattern: LivingSoulPattern;
};

const MAX_VISIBLE_PATTERNS = 4;

export function AiSetupSupportSections({
  workProfileUserId,
  savedWorkProfile,
  workProfileDraft,
  workProfileMessage,
  workProfileSaving,
  memorySnapshotVersion,
  onSaveWorkProfile,
  onWorkProfileDraftChange,
}: AiSetupSupportSectionsProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [editorExpanded, setEditorExpanded] = useState(false);
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

  const activityLabels = savedWorkProfile.workActivities.map((activity) => (
    onboardingActivityLabel(activity, effectiveLanguage)
  ));
  const hasProfile = activityLabels.length > 0 || savedWorkProfile.workDescription.trim().length > 0;
  const document = memory.document;
  const explicitPatternCount = document
    ? document.learned.workSupport.length + document.learned.drift.length + document.learned.ambiguities.length
    : 0;
  const contextualPatternCount = document?.contextualPriors.filter((prior) => prior.observedDays.length >= 3).length ?? 0;
  const totalPatternCount = explicitPatternCount + contextualPatternCount;
  const patternPreviews = useMemo(() => recentPatternPreviews(document), [document]);
  const updatedLabel = document
    ? formatRelativeTime(document.updatedAt, effectiveLanguage === "ko" ? "ko-KR" : "en-US")
    : null;
  const editorPanelId = "ai-setup-memory-work-profile-editor";
  const editorButtonId = "ai-setup-memory-work-profile-edit";
  const primaryStatusTone = memory.status === "ready" ? "active" : memory.status === "error" ? "error" : "idle";
  const primaryStatusLabel = memory.status === "ready"
    ? t("settings.ai.memoryStatusActive")
    : memory.status === "error"
      ? t("settings.ai.memoryStatusUnavailable")
      : memory.status === "empty"
        ? t("settings.ai.memoryStatusReady")
        : t("settings.ai.memoryStatusLoading");

  return (
    // A plain div with only aria-label is ignored by screen readers, so the
    // Memory overview and its status line carry real grouping roles.
    <section className="ai-memory" aria-label={t("settings.ai.memoryOverviewAria")}>
      <header className="ai-memory__intro">
        <h4 id="ai-memory-title">{t("settings.ai.memoryHeroTitle")}</h4>
        <p>{t("settings.ai.memoryLoopDescription")}</p>
        <div className="ai-memory-status" role="group" aria-label={t("settings.ai.memoryStatusAria")}>
          <span className={`ai-memory-status__item ai-memory-status__item--${primaryStatusTone}`}>
            <span aria-hidden="true" />
            {primaryStatusLabel}
          </span>
          <span className="ai-memory-status__item">{t("settings.ai.memoryStatusLocal")}</span>
          {updatedLabel ? (
            <span className="ai-memory-status__item">
              {t("settings.ai.memoryStatusUpdated", { time: updatedLabel })}
            </span>
          ) : null}
          {document ? (
            <span className="ai-memory-status__item ai-memory-status__item--file">
              Soul.md · rev. {document.revision}
            </span>
          ) : null}
        </div>
      </header>

      <section className={`ai-memory-row${editorExpanded ? " is-expanded" : ""}`} aria-labelledby="ai-memory-profile-title">
        <div className="ai-memory-row__head">
          <div className="ai-memory-row__title">
            <h5 id="ai-memory-profile-title">{t("settings.ai.memoryWorkContextLabel")}</h5>
            <p>{t("settings.ai.memoryWorkContextDescription")}</p>
          </div>
          <button
            id={editorButtonId}
            type="button"
            className="settings-btn ai-memory-row__action"
            aria-controls={editorPanelId}
            aria-expanded={editorExpanded}
            onClick={() => setEditorExpanded((current) => !current)}
          >
            {editorExpanded ? t("settings.ai.memoryCloseEditor") : t("common.edit")}
          </button>
        </div>
        {editorExpanded ? null : hasProfile ? (
          <div className="ai-memory-row__body">
            {activityLabels.length > 0 ? (
              <div className="ai-memory-tags" role="list" aria-label={t("settings.ai.selectedWorkActivities")}>
                {activityLabels.map((activity) => <span key={activity} role="listitem">{activity}</span>)}
              </div>
            ) : null}
            <p className="ai-memory-row__value">
              {savedWorkProfile.workDescription.trim() || t("settings.ai.memoryProfileNoDescription")}
            </p>
          </div>
        ) : (
          <div className="ai-memory-row__body ai-memory-row__body--empty">
            <p className="ai-memory-row__value">{t("settings.ai.memoryProfileEmptyTitle")}</p>
            <p className="ai-memory-row__hint">{t("settings.ai.memoryProfileEmptyDescription")}</p>
          </div>
        )}
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
      </section>

      <section className="ai-memory-row" aria-labelledby="ai-memory-learned-title">
        <div className="ai-memory-row__head">
          <div className="ai-memory-row__title">
            <h5 id="ai-memory-learned-title">{t("settings.ai.memoryCorrectionsLabel")}</h5>
            <p>{t("settings.ai.memoryCorrectionsDescription")}</p>
          </div>
          {memory.status === "ready" && totalPatternCount > 0 ? (
            <span className="ai-memory-row__count">
              {t("settings.ai.memoryPatternCount", { count: totalPatternCount })}
            </span>
          ) : null}
        </div>
        {memory.status === "loading" ? (
          <div className="ai-memory-row__body">
            <p className="ai-memory-row__hint">{t("settings.ai.memoryLoading")}</p>
          </div>
        ) : memory.status === "error" ? (
          <div className="ai-memory-row__body ai-memory-row__body--empty">
            <p className="ai-memory-row__value">{t("settings.ai.memoryUnreadableTitle")}</p>
            <p className="ai-memory-row__hint">{t("settings.ai.memoryUnreadableDescription")}</p>
          </div>
        ) : patternPreviews.length > 0 ? (
          <div className="ai-memory-row__body">
            <dl className="ai-memory-patterns">
              {patternPreviews.map(({ kind, pattern }) => (
                <div key={`${kind}-${pattern.summary}`}>
                  <dt>{patternKindLabel(kind, t)}</dt>
                  <dd>{pattern.summary}</dd>
                </div>
              ))}
            </dl>
            {document ? (
              <div className="ai-memory-breakdown" role="group" aria-label={t("settings.ai.memoryPatternBreakdownAria")}>
                <span>{t("settings.ai.memoryPatternWork", { count: document.learned.workSupport.length })}</span>
                <span>{t("settings.ai.memoryPatternDrift", { count: document.learned.drift.length })}</span>
                <span>{t("settings.ai.memoryPatternContext", { count: contextualPatternCount })}</span>
              </div>
            ) : null}
          </div>
        ) : contextualPatternCount > 0 ? (
          // Repeated context exists but has no readable summary of its own, so
          // the count above must not sit over a "nothing learned yet" body.
          <div className="ai-memory-row__body">
            <p className="ai-memory-row__hint">
              {t("settings.ai.memoryContextOnlyDescription", { count: contextualPatternCount })}
            </p>
          </div>
        ) : (
          <div className="ai-memory-row__body ai-memory-row__body--empty">
            <p className="ai-memory-row__value">{t("settings.ai.memoryPatternsEmptyTitle")}</p>
            <p className="ai-memory-row__hint">{t("settings.ai.memoryPatternsEmptyDescription")}</p>
          </div>
        )}
      </section>
    </section>
  );
}

function recentPatternPreviews(document: LivingSoulDocument | null): readonly PatternPreview[] {
  if (!document) return [];
  return [
    ...document.learned.workSupport.map((pattern) => ({ kind: "work" as const, pattern })),
    ...document.learned.drift.map((pattern) => ({ kind: "drift" as const, pattern })),
    ...document.learned.ambiguities.map((pattern) => ({ kind: "ambiguity" as const, pattern })),
  ]
    .sort((a, b) => Date.parse(b.pattern.lastObservedAt) - Date.parse(a.pattern.lastObservedAt))
    .slice(0, MAX_VISIBLE_PATTERNS);
}

function patternKindLabel(
  kind: PatternPreview["kind"],
  t: LocalizationController["t"],
): string {
  switch (kind) {
    case "work":
      return t("settings.ai.memoryPatternKindWork");
    case "drift":
      return t("settings.ai.memoryPatternKindDrift");
    case "ambiguity":
      return t("settings.ai.memoryPatternKindAmbiguity");
  }
}
