import { localeForDisplayLanguage } from "../../lib/formatting";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { capturePostHogEvent } from "../../lib/analytics/posthogClient";
import {
  changeLivingSoulPattern, livingSoulPatternHash, reviewLivingSoulPattern,
  type LivingSoulResolvedContext,
  type LivingSoulDocument, type LivingSoulPattern, type LivingSoulPatternKind,
  type LivingSoulPatternOrigin,
} from "../classification/livingSoul";
import { localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { MemoryIcon } from "./memoryIcons";

type Props = {
  readonly document: LivingSoulDocument;
  readonly ownerId: string;
  readonly onChange: (document: LivingSoulDocument) => void;
  readonly onStale: () => void;
};

export function MemoryPatternCards({ document, ownerId, onChange, onStale }: Props) {
  const { t, effectiveLanguage } = useLocalization();
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [undoHash, setUndoHash] = useState<string | null>(null);
  const [origins, setOrigins] = useState<Record<string, LivingSoulPatternOrigin>>({});
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(Object.values(document.learned).flat().map(async (pattern) => [
      pattern.summary, await livingSoulPatternHash(pattern.summary),
    ] as const)).then((entries) => {
      if (!cancelled) {
        setHashes(Object.fromEntries(entries));
        setOrigins(Object.fromEntries(entries.flatMap(([summary, hash]) => {
          const origin = document.memoryControls?.origins[hash];
          return origin ? [[summary, origin]] : [];
        })));
      }
    });
    return () => { cancelled = true; };
  }, [document]);

  const patterns = (Object.entries(document.learned) as [LivingSoulPatternKind, readonly LivingSoulPattern[]][])
    .flatMap(([kind, items]) => items.map((pattern) => ({ kind, pattern })))
    .sort((a, b) => Date.parse(b.pattern.lastObservedAt) - Date.parse(a.pattern.lastObservedAt));
  const kindLabels = {
    workSupport: t("settings.ai.memoryPatternKindWork"),
    drift: t("settings.ai.memoryPatternKindDrift"),
    ambiguities: t("settings.ai.memoryPatternKindAmbiguity"),
  };
  const formatDate = (timestamp: string) => new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), {
    year: "numeric", month: "short", day: "numeric",
  }).format(new Date(timestamp));

  async function mutate(operation: () => Promise<LivingSoulResolvedContext>, message: string, undo?: string): Promise<boolean | null> {
    if (saving.current) return null;
    saving.current = true;
    setBusy(true);
    setNotice(null);
    setUndoHash(null);
    try {
      const result = await operation();
      if (!mounted.current) return true;
      onChange(result.document);
      setEditing(null);
      setForgetting(null);
      setNotice(message);
      setUndoHash(undo ?? null);
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      // The stored revision moved on (another window or the tracker wrote Memory):
      // load the latest in place so the next attempt starts from current data.
      if (code === "memory_changed") onStale();
      if (mounted.current) {
        if (code === "memory_changed") { setEditing(null); setForgetting(null); }
        setNotice(t(code === "memory_limit" ? "settings.ai.memoryLimitReached"
          : code === "memory_restore_limit" ? "settings.ai.memoryRestoreLimit"
            : code === "memory_duplicate" ? "settings.ai.memoryDuplicate"
              : code === "memory_changed" ? "settings.ai.memoryChangedElsewhere" : "settings.ai.memoryChangeFailed"));
      }
      return false;
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const rejected = document.memoryControls?.rejectedPatterns ?? {};
  const rejectedEntries = Object.entries(rejected).sort(([, a], [, b]) => Date.parse(b.rejectedAt) - Date.parse(a.rejectedAt));
  function save(kind: LivingSoulPatternKind, summary: string, replacement?: string) {
    return mutate(() => changeLivingSoulPattern({ ownerId, expectedRevision: document.revision, kind, summary, replacement }),
      t(replacement === undefined ? "settings.ai.memoryForgotten" : "settings.ai.memoryEdited"));
  }
  function review(kind: LivingSoulPatternKind, summary: string, action: "confirm" | "unconfirm" | "reject" | "restore" | "forgetRejected") {
    const messages = { confirm: "settings.ai.memoryConfirmedNotice", unconfirm: "settings.ai.memoryUnconfirmedNotice",
      reject: "settings.ai.memoryRejectedNotice", restore: "settings.ai.memoryRestoredNotice", forgetRejected: "settings.ai.memoryForgotten" } as const;
    // Counts only, for whether kept memories (especially adopted suggestions) are later confirmed or rejected.
    const origin = action === "restore"
      ? Object.values(rejected).find((entry) => entry.pattern.summary === summary)?.origin
      : origins[summary];
    return mutate(() => reviewLivingSoulPattern({ ownerId, expectedRevision: document.revision, kind, summary, action }),
      t(messages[action]), action === "reject" ? hashes[summary] : undefined).then((saved) => {
      if (saved === null || action === "forgetRejected") return;
      capturePostHogEvent("memory_pattern_feedback", {
        action, kind, origin: origin?.source ?? "legacy", result: saved ? "success" : "error",
      });
    });
  }
  function toggleDetail(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
    setEditing(null);
    setForgetting(null);
  }

  const renderRow = ({ kind, pattern }: (typeof patterns)[number]) => {
      const key = kind + ":" + pattern.summary;
      const origin = origins[pattern.summary];
      const hash = hashes[pattern.summary];
      const confirmed = Boolean(hash && document.memoryControls?.confirmedHashes?.includes(hash));
      const open = Boolean(expanded[key]);
      const detailId = "memory-detail-" + (hash ?? key).slice(0, 16).replace(/[^a-z0-9]/gi, "");
      const sourceKey = origin?.source === "user" ? "user" : origin?.source === "correction" ? "correction" : origin?.source === "suggestion" ? "suggestion" : "legacy";
      return <article className="memory-row" key={key} aria-label={pattern.summary}>
        <p className="memory-row__summary">{pattern.summary}</p>
        <div className="memory-row__meta">
          <span className={"memory-row__kind memory-row__kind--" + kind}>{kindLabels[kind]}</span>
          <span>{t(sourceKey === "user" ? "settings.ai.memorySourceUser"
            : sourceKey === "correction" ? "settings.ai.memorySourceCorrection"
              : sourceKey === "suggestion" ? "settings.ai.memorySourceSuggestion" : "settings.ai.memorySourceLegacy")}</span>
          {confirmed ? <span className="memory-row__confirmed"><MemoryIcon name="check" size={12} />&nbsp;{t("settings.ai.memoryConfirmedBadge")}</span> : null}
          <span>{t("settings.ai.memoryObserved", { date: formatDate(pattern.lastObservedAt) })}</span>
          <button className="memory-row__toggle" type="button" aria-expanded={open} aria-controls={detailId} onClick={() => toggleDetail(key)}>
            {t("settings.ai.memoryDetails")}<MemoryIcon name="chevronDown" size={13} />
          </button>
        </div>
        <div className="memory-row__actions">
          <div className="memory-feedback" role="group" aria-label={t("settings.ai.memoryFeedbackAria")}>
            <button className="memory-feedback__btn memory-feedback__btn--up" type="button" disabled={busy || !hash} aria-pressed={confirmed}
              aria-label={t(confirmed ? "settings.ai.memoryConfirmed" : "settings.ai.memoryConfirm")}
              title={t(confirmed ? "settings.ai.memoryUnconfirm" : "settings.ai.memoryConfirmHint")}
              onClick={() => void review(kind, pattern.summary, confirmed ? "unconfirm" : "confirm")}>
              <MemoryIcon name="thumbsUp" filled={confirmed} />
            </button>
            <button className="memory-feedback__btn memory-feedback__btn--down" type="button" disabled={busy || !hash}
              aria-label={t("settings.ai.memoryReject")} title={t("settings.ai.memoryRejectHint")}
              onClick={() => void review(kind, pattern.summary, "reject")}>
              <MemoryIcon name="thumbsDown" />
            </button>
          </div>
        </div>
        {open ? <div className="memory-detail" id={detailId}>
          {editing === key ? <form className="memory-editor" onSubmit={(event) => { event.preventDefault(); void save(kind, pattern.summary, draft); }}>
            <label>{t("settings.ai.memoryEditLabel")}
              <textarea className="settings-input" maxLength={240} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} autoFocus required />
            </label>
            <p className="memory-detail__note">{t("settings.ai.memoryEditHint")}</p>
            <div className="memory-detail__actions">
              <button className="settings-btn" type="button" disabled={busy} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
              <button className="settings-btn settings-btn--primary" type="submit" disabled={busy || !draft.trim()}>{t("common.save")}</button>
            </div>
          </form> : forgetting === key ? <>
            <p className="memory-detail__lead">{t("settings.ai.memoryForgetHint")}</p>
            <div className="memory-detail__actions">
              <button className="settings-btn" type="button" disabled={busy} onClick={() => setForgetting(null)}>{t("common.cancel")}</button>
              <button className="settings-btn danger" type="button" disabled={busy} onClick={() => void save(kind, pattern.summary)}>{t("settings.ai.memoryForget")}</button>
            </div>
          </> : <>
            <p className="memory-detail__title">{t("settings.ai.memoryEvidence")}</p>
            <p className="memory-detail__lead">{t(sourceKey === "user" ? "settings.ai.memoryUserEvidence"
              : sourceKey === "correction" ? "settings.ai.memoryCorrectionEvidence"
                : sourceKey === "suggestion" ? "settings.ai.memorySuggestionEvidence" : "settings.ai.memoryLegacyEvidence")}</p>
            <dl className="memory-facts">
              {origin ? <><dt>{t("settings.ai.memoryFactRecorded")}</dt><dd>{formatDate(origin.recordedAt)}</dd></> : null}
              {origin?.feedbackKind ? <><dt>{t("settings.ai.memoryFactFeedback")}</dt>
                <dd>{t(origin.feedbackKind === "not_drift" ? "settings.ai.memoryFeedbackNotDrift" : "settings.ai.memoryFeedbackManual")}</dd></> : null}
              {origin?.activity ? <><dt>{t(sourceKey === "suggestion" ? "settings.ai.memoryFactPlace" : "settings.ai.memoryFactActivity")}</dt><dd>{origin.activity}</dd></> : null}
              {origin?.productivity ? <><dt>{t(sourceKey === "suggestion" ? "settings.ai.memoryFactFiledAs" : "settings.ai.memoryFactProductivity")}</dt><dd>{localizedProductivityLabel(origin.productivity, t)}</dd></> : null}
              <dt>{t(sourceKey === "suggestion" ? "settings.ai.memoryFactDays" : "settings.ai.memoryFactCount")}</dt><dd>{pattern.evidenceCount}</dd>
            </dl>
            <p className="memory-detail__note">{t("settings.ai.memoryEvidenceLimit")}</p>
            <div className="memory-detail__actions">
              <button className="settings-btn" type="button" disabled={busy} onClick={() => { setEditing(key); setDraft(pattern.summary); setForgetting(null); setNotice(null); }}>{t("common.edit")}</button>
              <button className="settings-btn" type="button" disabled={busy} onClick={() => { setForgetting(key); setEditing(null); setNotice(null); }}>{t("settings.ai.memoryForget")}</button>
            </div>
          </>}
        </div> : null}
      </article>;
  };
  const primary = patterns.slice(0, 4);
  const extra = patterns.slice(4);
  const undoEntry = undoHash ? rejected[undoHash] : undefined;
  // The outcome of the last change (with Undo after hiding a pattern) takes the
  // card's first line in the same grid cell, so the list below never moves.
  const noticeContent = notice ? <>
    {notice}
    {undoEntry ? <button className="memory-card__undo" disabled={busy} type="button"
      onClick={() => void review(undoEntry.kind, undoEntry.pattern.summary, "restore")}>{t("settings.ai.memoryUndo")}</button> : null}
  </> : null;
  return <div className="memory-patterns">
    <div className="memory-card">
      {/* How these are used sits inside the card, like the Suggested disclosure. */}
      <MemoryCardLine
        className={patterns.length > 0 ? "memory-card__note" : "memory-card--empty memory-card__text"}
        text={t(patterns.length > 0 ? "settings.ai.memoryCorrectionsHint" : "settings.ai.memoryNoActive")}
        notice={noticeContent}
      />
      {patterns.length === 0 ? null : <div className="memory-list">
        {primary.map(renderRow)}
        {extra.length > 0 ? <div className="memory-more" data-open={showAll}>
          <div className="memory-more__inner" id="memory-more-rows" aria-hidden={!showAll}>{extra.map(renderRow)}</div>
        </div> : null}
      </div>}
    </div>
    {extra.length > 0 ? <div className="memory-toolbar">
      {extra.length > 0 ? <button className="memory-more-btn" type="button" aria-expanded={showAll} aria-controls="memory-more-rows" disabled={busy} onClick={() => setShowAll(!showAll)}>
        {t(showAll ? "settings.ai.memoryShowLess" : "settings.ai.memoryShowAll", { count: patterns.length })}<MemoryIcon name="chevronDown" size={14} />
      </button> : null}
    </div> : null}
    {rejectedEntries.length > 0 ? <div className="memory-card memory-excluded">
      <button className="memory-card__foot memory-card__foot--spread" type="button" aria-expanded={excludedOpen} onClick={() => setExcludedOpen(!excludedOpen)}>
        <span>{t("settings.ai.memoryRejectedList", { count: rejectedEntries.length })}</span><MemoryIcon name="chevronDown" size={14} />
      </button>
      {excludedOpen ? <>
        <p className="memory-card__note">{t("settings.ai.memoryRejectedHint")}</p>
        <div className="memory-list">
          {rejectedEntries.map(([hash, entry]) =>
            <article className="memory-row memory-row--excluded" key={hash} aria-label={entry.pattern.summary}>
              <p className="memory-row__summary">{entry.pattern.summary}</p>
              <div className="memory-row__meta"><span>{t("settings.ai.memoryRejectedAt", { date: formatDate(entry.rejectedAt) })}</span></div>
              {forgetting === hash ? <div className="memory-detail">
                <p className="memory-detail__lead">{t("settings.ai.memoryForgetRejectedHint")}</p>
                <div className="memory-detail__actions">
                  <button className="settings-btn" type="button" disabled={busy} onClick={() => setForgetting(null)}>{t("common.cancel")}</button>
                  <button className="settings-btn danger" type="button" disabled={busy} onClick={() => void review(entry.kind, entry.pattern.summary, "forgetRejected")}>{t("settings.ai.memoryForget")}</button>
                </div>
              </div> : <div className="memory-row__buttons">
                <button className="settings-btn" type="button" disabled={busy} onClick={() => void review(entry.kind, entry.pattern.summary, "restore")}>{t("settings.ai.memoryRestore")}</button>
                <button className="settings-btn" type="button" disabled={busy} onClick={() => setForgetting(hash)}>{t("settings.ai.memoryForget")}</button>
              </div>}
            </article>)}
        </div>
      </> : null}
    </div> : null}
  </div>;
}

/**
 * The card's first line, with room for the outcome of the last change. The
 * outcome is laid over the line in the same grid cell while the line stays
 * laid out invisibly, so the card keeps the taller of the two heights. The
 * live region stays mounted, so each new outcome is announced.
 */
function MemoryCardLine({ className, text, notice }: { readonly className: string; readonly text: string; readonly notice: ReactNode }) {
  return <div className={className + " memory-card__line"}>
    <span data-hidden={notice ? "" : undefined} aria-hidden={notice ? true : undefined}>{text}</span>
    <span className="memory-card__notice" role="status">{notice}</span>
  </div>;
}
