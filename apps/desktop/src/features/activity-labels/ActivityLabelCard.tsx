import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { ActivityInspectorLabel } from "./activityInspectorLabel";
import type { ActivityLabelBlock } from "./activityLabelBlocks";
import { useActivityLabels } from "./ActivityLabelsContext";
import { setTeamBlocksExcluded, useTeamBlockExclusionAvailable, useTeamBlocksExcluded } from "../team/teamBlockExclusions";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

/** The tracker keeps a user's name to this many characters. */
const TITLE_MAX_LENGTH = 80;

function clock(ms: number): string {
  const date = new Date(ms);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function PencilIcon() {
  return <svg {...iconProps}><path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5zM14.5 7.5l3 3" /></svg>;
}

function PlusIcon() {
  return <svg {...iconProps}><path d="M12 5.5v13M5.5 12h13" /></svg>;
}

/** The block's other timeline cards, in time order, so a long block reads as the sequence it was. */
function OtherCards({ label }: { readonly label: ActivityInspectorLabel }) {
  const others = label.block.otherCards;
  if (others.length === 0) return null;
  return (
    <ul className="activity-label-row__more">
      {others.map((other) => (
        <li key={other.startMs}>
          <span className="activity-label-row__time">{clock(other.startMs)}</span>
          <span>{other.title}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The block's name beneath the card's own app/site header: it uses the card's
 * full width above the Category/Productivity rows, with its label kept for
 * screen readers only. Day and Week cards share it. A pinned card passes
 * `editable`, so the name can be renamed in place where the tracker can store it.
 */
export function ActivityLabelRow({ label, editable = false, disabled = false, meta = null, hideOtherCards = false }: {
  readonly label: ActivityInspectorLabel | null | undefined;
  readonly editable?: boolean;
  readonly disabled?: boolean;
  /** Shown right under the name (the panel's time and recorded line). */
  readonly meta?: ReactNode;
  /** The panel's time-ordered detail already lists what the other cards held. */
  readonly hideOtherCards?: boolean;
}) {
  const { t } = useLocalization();
  const editor = useActivityLabelEditor(editable ? label : null);
  if (editor.available && label) return <EditableActivityLabelRow label={label} editor={editor} disabled={disabled} meta={meta} hideOtherCards={hideOtherCards} />;
  const display = label?.display;
  if (!label || !display) {
    // A block without a name can still be kept from the team where it can be edited.
    const toggle = editable && label ? <TeamBlockShareToggle label={label} /> : null;
    return meta || toggle ? <div className="activity-label-row">{meta}{toggle}</div> : null;
  }
  return (
    <div className="activity-label-row">
      <span className="activity-label-row__title">
        <span className="sr-only">{t("activityLabels.sectionLabel")}: </span>
        {display.title}
      </span>
      {meta}
      {display.description ? <span className="activity-label-row__description">{display.description}</span> : null}
      {hideOtherCards ? null : <OtherCards label={label} />}
    </div>
  );
}

/**
 * The one correction a name offers is renaming it for this block. An empty
 * name brings back the app/site display; either way the AI does not name the
 * block again until the user restores the original. Records, classification
 * and totals stay as they are, and nothing leaves the device.
 */
export type ActivityLabelEditor = {
  readonly available: boolean;
  /** The block holds the user's own name, or a cleared one. */
  readonly edited: boolean;
  readonly busy: boolean;
  readonly error: boolean;
  /** Resolves false when the tracker could not store it. */
  readonly rename: (title: string) => Promise<boolean>;
  readonly restore: () => Promise<boolean>;
};

function isUserChoice(block: ActivityLabelBlock): boolean {
  return block.resolution.kind === "user";
}

export function useActivityLabelEditor(label: ActivityInspectorLabel | null | undefined): ActivityLabelEditor {
  const controller = useActivityLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const blockKey = label?.block.key ?? null;

  useEffect(() => {
    setError(false);
  }, [blockKey]);

  const edited = Boolean(label && isUserChoice(label.block));
  const cleared = edited && label?.display === null;
  const available = Boolean(label && controller?.editingEnabled && (label.display || cleared));
  // A merged Week block draws several canonical blocks as one, so a choice applies to all of them.
  const members = label ? label.members ?? [label.block] : [];
  const run = async (apply: (block: ActivityLabelBlock) => Promise<void>) => {
    if (busy || !controller || !available) return false;
    setBusy(true);
    setError(false);
    try {
      for (const block of members) await apply(block);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rename = (title: string) => run((block) => (
    controller!.saveUserLabel(block, title, title ? block.display?.description ?? label?.display?.description ?? "" : "")
  ));
  const restore = () => run(async (block) => {
    if (isUserChoice(block)) await controller!.resetUserLabel(block);
  });
  return { available, edited, busy, error, rename, restore };
}

/**
 * Click the name (or the pencil that shows on hover or focus) to rename it,
 * as Dayflow and Finder do: Enter or leaving the field saves, Escape keeps the
 * name. A cleared name shows "Add task name" in its place.
 */
function EditableActivityLabelRow({ label, editor, disabled, meta, hideOtherCards }: {
  readonly label: ActivityInspectorLabel;
  readonly editor: ActivityLabelEditor;
  readonly disabled: boolean;
  readonly meta: ReactNode;
  readonly hideOtherCards: boolean;
}) {
  const { t } = useLocalization();
  const display = label.display;
  const current = display?.title ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  // The saved name shows until the block's label catches up with it.
  const [pending, setPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== null;
  const blockKey = label.block.key;

  useEffect(() => {
    setDraft(null);
    setPending(null);
  }, [blockKey]);
  useEffect(() => {
    setPending(null);
  }, [current]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // The field grows with the name; scrollHeight leaves out its border.
    const style = getComputedStyle(input);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    input.style.height = "auto";
    input.style.height = input.scrollHeight + border + "px";
  }, [draft]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editRef.current?.focus({ preventScroll: true });
  }, [editing]);

  const start = () => {
    if (disabled || editor.busy) return;
    setDraft(current);
  };
  const finish = (restoreFocus: boolean) => {
    returnFocus.current = restoreFocus;
    setDraft(null);
  };
  const commit = (restoreFocus: boolean) => {
    if (draft === null) return;
    const title = draft.trim();
    finish(restoreFocus);
    if (title === current) return;
    setPending(title);
    void editor.rename(title).then((saved) => {
      if (!saved) setPending(null);
    });
  };
  const restore = () => {
    finish(true);
    setPending(null);
    void editor.restore();
  };
  const handleKeyDown = (keyEvent: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // A key that finishes an IME composition (Korean, Japanese) is not a decision.
    if (keyEvent.nativeEvent.isComposing || keyEvent.keyCode === 229) return;
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      commit(true);
    } else if (keyEvent.key === "Escape") {
      // Escape keeps the name; the panel waits for the next press to close.
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(true);
    }
  };

  const shown = pending ?? current;
  const sectionLabel = t("activityLabels.sectionLabel");
  return (
    <div
      className="activity-label-row activity-label-row--editable"
      data-editing={editing || undefined}
      aria-busy={editor.busy || undefined}
    >
      {editing ? (
        <>
          <textarea
            ref={inputRef}
            className="activity-label-row__input"
            aria-label={sectionLabel}
            rows={1}
            maxLength={TITLE_MAX_LENGTH}
            spellCheck={false}
            placeholder={t("activityLabels.emptyHint")}
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
            onKeyDown={handleKeyDown}
            onBlur={(blurEvent) => {
              // Switching to another app keeps the field open, as Finder's rename does.
              if (!document.hasFocus()) return;
              if (blurEvent.relatedTarget instanceof Element && blurEvent.relatedTarget.closest(".activity-label-row__restore")) return;
              commit(false);
            }}
          />
          {editor.edited ? (
            <button
              type="button"
              className="activity-label-row__restore"
              // The field keeps focus, so a press here does not first save the
              // draft and close the editor (WebKit gives a pressed button no focus).
              onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
              onClick={restore}
              onBlur={(blurEvent) => {
                if (blurEvent.relatedTarget !== inputRef.current && document.hasFocus()) commit(false);
              }}
            >
              {t("activityLabels.restore")}
            </button>
          ) : null}
        </>
      ) : shown ? (
        <div className="activity-label-row__heading">
          <span className="activity-label-row__title" onClick={start}>
            <span className="sr-only">{sectionLabel}: </span>
            {shown}
          </span>
          <button
            ref={editRef}
            type="button"
            className="activity-label-row__edit"
            aria-label={t("activityLabels.edit")}
            title={t("activityLabels.edit")}
            disabled={disabled}
            onClick={start}
          >
            <PencilIcon />
          </button>
        </div>
      ) : (
        <button
          ref={editRef}
          type="button"
          className="activity-label-row__add"
          disabled={disabled}
          onClick={start}
        >
          <PlusIcon />
          <span>{t("activityLabels.add")}</span>
        </button>
      )}
      {meta}
      {shown && display?.description ? (
        <span className="activity-label-row__description">{display.description}</span>
      ) : null}
      {shown && !hideOtherCards ? <OtherCards label={label} /> : null}
      <TeamBlockShareToggle label={label} />
      {editor.error ? <p className="activity-label-row__error" role="alert">{t("activityLabels.saveError")}</p> : null}
    </div>
  );
}

/**
 * "Don't share with team" on a Your Day block (owner decision 2026-11-08), while the
 * an eligible team allows it: the block's name, time of day and time stay out of what teams
 * receive from the next share. The person's own day keeps it.
 */
function TeamBlockShareToggle({ label }: { readonly label: ActivityInspectorLabel }) {
  const { t } = useLocalization();
  const available = useTeamBlockExclusionAvailable();
  const blocks = (label.members ?? [label.block]).map((block) => ({ start: block.startMs, end: block.endMs }));
  const excluded = useTeamBlocksExcluded(available ? blocks : []);
  if (!available) return null;
  return (
    <div className={"activity-label-row__team" + (excluded ? " is-excluded" : "")}>
      {excluded ? <span className="activity-label-row__team-state">{t("activityLabels.team.excluded")}</span> : null}
      <button
        type="button"
        className="activity-label-row__team-toggle"
        aria-pressed={excluded}
        title={excluded ? undefined : t("activityLabels.team.excludeHint")}
        onClick={() => setTeamBlocksExcluded(blocks, !excluded)}
      >
        {excluded ? t("activityLabels.team.include") : t("activityLabels.team.exclude")}
      </button>
    </div>
  );
}
