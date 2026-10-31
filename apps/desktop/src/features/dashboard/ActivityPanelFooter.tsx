import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type SVGProps } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import type { DescribedActionError } from "../../lib/actionErrors";
import { useLocalization } from "../localization/LocalizationContext";
import { ACTIVITY_DELETE_HOLD_MS, DEFAULT_ACTIVITY_DELETE_STYLE, type ActivityDeleteStyle } from "./activityDeleteStyle";

/** The previous candidate's disarm window, as history deletion's second press. */
export const FOOTER_ARM_MS = 3000;
/** A second press this soon after arming is a double-click, not a decision. */
export const FOOTER_ARM_GUARD_MS = 350;
/** How long "Hold to delete" stays after a press that was let go too soon. */
export const FOOTER_HOLD_HINT_MS = 2400;

export type PanelFooterDeletion = {
  /** True while the delete waits for its confirmation (or runs, in the one-press candidates). */
  readonly pending: boolean;
  /** "this activity" or "9 activities". */
  readonly records: string;
  readonly error: DescribedActionError | null;
  readonly busy: boolean;
  readonly confirmDisabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

export type ActivityPanelFooterProps = {
  readonly deleteLabel: string;
  readonly canDelete: boolean;
  readonly disabled: boolean;
  readonly onDelete?: () => void;
  readonly deletion: PanelFooterDeletion | null;
  /** How Delete asks before it deletes (activityDeleteStyle.ts). */
  readonly deleteStyle?: ActivityDeleteStyle;
};

const iconProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

function TrashIcon() {
  return <svg {...iconProps}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12h9.4l.8-12M10 10.5v5M14 10.5v5" /></svg>;
}

function FooterError({ error }: { readonly error: DescribedActionError }) {
  return (
    <p className="week-activity-inspector__error activity-inspection__footer-error" role="alert" title={error.detail ?? error.message}>
      {error.message}
      {error.detail ? <span className="sr-only"> {error.detail}</span> : null}
    </p>
  );
}

/**
 * After a pending delete is cancelled, focus returns to the delete unless the
 * person already moved elsewhere. WebKit moves a mouse press on a button to
 * its nearest focusable ancestor, so an ancestor of the footer counts as
 * "nowhere in particular" too.
 */
function useReturnFocus(pending: boolean) {
  const requestRef = useRef<HTMLButtonElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending) {
      const active = document.activeElement;
      const footer = footerRef.current;
      if (!active || active === document.body || (footer && (footer.contains(active) || active.contains(footer)))) {
        requestRef.current?.focus({ preventScroll: true });
      }
    }
    wasPending.current = pending;
  }, [pending]);
  return { requestRef, footerRef };
}

/**
 * A fixed window that restarts whole each time it becomes active. It does not
 * pause under the pointer: the arming click leaves the pointer there, and an
 * armed delete must not outlast its window.
 */
function useArmedWindow(active: boolean, ms: number, onDone: () => void) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => done.current(), ms);
    return () => window.clearTimeout(id);
  }, [active, ms]);
}

/** False for the first moments after arming, so a double-click cannot confirm. */
function useArmedReady(pending: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!pending) return;
    const id = window.setTimeout(() => setReady(true), FOOTER_ARM_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [pending]);
  return ready;
}

/**
 * Lets a waiting delete go without a timer: a press outside the given
 * elements, the mouse leaving the bar, or keyboard focus moving on.
 */
function useLetGo(
  active: boolean,
  options: {
    readonly inside: readonly RefObject<HTMLElement | null>[];
    readonly leave?: RefObject<HTMLElement | null>;
    readonly focus?: RefObject<HTMLElement | null>;
  },
  onLetGo: () => void,
) {
  const letGo = useRef(onLetGo);
  letGo.current = onLetGo;
  const { inside, leave, focus } = options;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  useEffect(() => {
    if (!active) return undefined;
    const isInside = (target: EventTarget | null) => target instanceof Node
      && insideRef.current.some((ref) => ref.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) letGo.current();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") letGo.current();
    };
    const onFocusOut = (event: FocusEvent) => {
      // Only a move to another control counts; a window switch keeps it waiting.
      if (event.relatedTarget instanceof Node && !isInside(event.relatedTarget)) letGo.current();
    };
    const leaveElement = leave?.current ?? null;
    const focusElement = focus?.current ?? null;
    document.addEventListener("pointerdown", onPointerDown, true);
    leaveElement?.addEventListener("pointerleave", onPointerLeave);
    focusElement?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      leaveElement?.removeEventListener("pointerleave", onPointerLeave);
      focusElement?.removeEventListener("focusout", onFocusOut);
    };
  }, [active, focus, leave]);
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * True while the panel's content reaches the bar: a short window, or content
 * scrolled beneath it. Only then does the bar draw its divider and surface,
 * so it never sits on top of text; otherwise delete stands alone below the
 * content. The edge is a zero-height marker right after the content.
 */
function useContentReachesBar(
  footerRef: RefObject<HTMLDivElement | null>,
  edgeRef: RefObject<HTMLSpanElement | null>,
  shown: boolean,
) {
  const [reaches, setReaches] = useState(false);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const edge = edgeRef.current;
    if (!footer || !edge) return undefined;
    const measure = () => {
      const bar = footer.getBoundingClientRect();
      // Without layout (no height) there is nothing to cover.
      setReaches(bar.height > 0 && edge.getBoundingClientRect().top > bar.top - 0.5);
    };
    measure();
    const scroller = scrollParent(footer);
    scroller?.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (footer.parentElement) observer?.observe(footer.parentElement);
    if (scroller) observer?.observe(scroller);
    return () => {
      scroller?.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [edgeRef, footerRef, shown]);
  return reaches;
}

type HoldButtonProps = {
  readonly buttonRef: RefObject<HTMLButtonElement>;
  readonly label: string;
  readonly ariaLabel: string;
  readonly describedBy: string;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onHoldStart: () => void;
  readonly onLetGoEarly: () => void;
  readonly onHeld: () => void;
};

/**
 * Press and hold: the fill sweeps across the button while it is held and the
 * delete runs when it is full. Space or Enter held down works the same way.
 */
function HoldToDeleteButton({ buttonRef, label, ariaLabel, describedBy, disabled, pending, busy, onHoldStart, onLetGoEarly, onHeld }: HoldButtonProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(onHeld);
  held.current = onHeld;
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const start = () => {
    if (disabled || busy || timer.current !== null) return;
    setHolding(true);
    onHoldStart();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      held.current();
    }, ACTIVITY_DELETE_HOLD_MS);
  };
  const stop = (early: boolean) => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    if (early) onLetGoEarly();
  };
  const isHoldKey = (key: string) => key === " " || key === "Enter";
  return (
    <button
      ref={buttonRef}
      type="button"
      className="activity-inspection__bar-action activity-inspection__delete activity-inspection__hold"
      data-delete-request
      data-holding={holding || undefined}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-busy={busy}
      disabled={disabled}
      style={{ "--activity-hold-ms": String(ACTIVITY_DELETE_HOLD_MS) + "ms" } as CSSProperties}
      onPointerDown={(event) => {
        // Only the primary button holds; a secondary press opens nothing either.
        if (!(event.button > 0)) start();
      }}
      onPointerUp={() => stop(true)}
      onPointerLeave={() => stop(true)}
      onPointerCancel={() => stop(false)}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={() => stop(false)}
      onKeyDown={(event) => {
        if (!isHoldKey(event.key)) return;
        event.preventDefault();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (!isHoldKey(event.key)) return;
        event.preventDefault();
        stop(true);
      }}
    >
      <TrashIcon />
      {pending ? <ActionLabel busy={busy}>{label}</ActionLabel> : <span>{label}</span>}
      <span className="activity-inspection__hold-fill" aria-hidden="true">
        <TrashIcon />
        <span>{label}</span>
      </span>
    </button>
  );
}

/**
 * Panel placement: a bar pinned to the bottom of the column with one height.
 * The block's name is renamed where it is shown, so delete is the bar's one
 * action, and the bar draws its divider only while content reaches it. How
 * delete asks first is a Dev-selectable candidate; whichever it is, it stays
 * in this bar or the panel and never moves the activity above it.
 */
export function ActivityPanelFooter({ deleteLabel, canDelete, onDelete, deletion, deleteStyle = DEFAULT_ACTIVITY_DELETE_STYLE }: ActivityPanelFooterProps) {
  const { t } = useLocalization();
  const hintId = useId();
  const titleId = useId();
  const pending = deletion?.pending ?? false;
  const busy = deletion?.busy ?? false;
  const error = deletion?.error ?? null;
  const { requestRef, footerRef } = useReturnFocus(pending);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reaches = useContentReachesBar(footerRef, edgeRef, Boolean(onDelete));
  const cancel = () => deletion?.onCancel();
  const confirm = () => deletion?.onConfirm();
  useArmedWindow(deleteStyle === "timer" && pending && !busy && !error, FOOTER_ARM_MS, cancel);
  useLetGo(deleteStyle === "steady" && pending && !busy && !error, { inside: [requestRef], leave: footerRef, focus: requestRef }, cancel);
  useLetGo(deleteStyle === "popover" && pending && !busy, { inside: [requestRef, cardRef] }, cancel);
  const ready = useArmedReady(pending);
  const [holdHint, setHoldHint] = useState(false);
  useEffect(() => {
    if (!holdHint) return undefined;
    const id = window.setTimeout(() => setHoldHint(false), FOOTER_HOLD_HINT_MS);
    return () => window.clearTimeout(id);
  }, [holdHint]);
  if (!onDelete) return null;

  const records = deletion?.records ?? "";
  const hint = t("dashboard.activityDetail.deleteArmed", { records }) + " · " + t("dashboard.activityDetail.cannotUndo");
  const warning = t("dashboard.week.inspector.deleteWarning", { records });
  const deleteText = t("common.delete");
  const deleteNow = () => {
    onDelete();
    confirm();
  };
  const errorInBar = pending && error && deleteStyle !== "popover" && deleteStyle !== "panel" ? error : null;
  const noted = pending && !error && (deleteStyle === "note" || deleteStyle === "banner");
  // The bar is narrow (222px), so it shows the part that matters most; the full
  // sentence with the count is its hover title and screen-reader description.
  const noteText = t("dashboard.activityDetail.cannotUndo");
  const noteDetail = deleteStyle === "banner" ? warning : hint;

  let lead: ReactNode = <span />;
  if (errorInBar) lead = <FooterError error={errorInBar} />;
  else if (noted) lead = <p className="activity-inspection__footer-note" title={noteDetail} aria-hidden="true">{noteText}</p>;
  else if (deleteStyle === "hold" && holdHint && !pending) {
    lead = <p className="activity-inspection__footer-note" role="status">{t("dashboard.activityDetail.holdToDelete")}</p>;
  }

  const confirmInPlace = (tip?: string) => (
    <button
      ref={requestRef}
      type="button"
      className="activity-inspection__bar-action activity-inspection__delete"
      data-delete-request
      data-delete-confirm={pending || undefined}
      data-tip={tip}
      aria-label={pending ? undefined : deleteLabel}
      aria-describedby={pending && !error ? hintId : undefined}
      aria-busy={busy}
      disabled={pending ? deletion?.confirmDisabled : !canDelete}
      onClick={pending ? (ready ? confirm : undefined) : onDelete}
    >
      <TrashIcon />
      {pending ? <ActionLabel busy={busy}>{deleteText}</ActionLabel> : <span>{deleteText}</span>}
    </button>
  );
  const opener = (
    <button
      ref={requestRef}
      type="button"
      className="activity-inspection__bar-action activity-inspection__delete"
      data-delete-request
      data-open={pending || undefined}
      aria-label={deleteLabel}
      aria-haspopup={deleteStyle === "popover" ? "dialog" : undefined}
      aria-expanded={pending}
      disabled={busy || (!pending && !canDelete)}
      onClick={pending ? cancel : onDelete}
    >
      <TrashIcon />
      <span>{deleteText}</span>
    </button>
  );

  let actions: ReactNode;
  switch (deleteStyle) {
    case "timer":
      actions = (
        <button
          ref={requestRef}
          type="button"
          className="activity-inspection__bar-action activity-inspection__delete"
          data-delete-request
          data-delete-confirm={pending || undefined}
          data-tip={pending && !error ? hint : undefined}
          aria-label={pending ? undefined : deleteLabel}
          aria-describedby={pending && !error ? hintId : undefined}
          aria-busy={busy}
          disabled={pending ? deletion?.confirmDisabled : !canDelete}
          onClick={pending ? (ready ? confirm : undefined) : onDelete}
        >
          <TrashIcon />
          {pending
            ? <ActionLabel busy={busy}>{t("dashboard.activityDetail.confirmDelete")}</ActionLabel>
            : <span>{deleteText}</span>}
          {pending && !busy && !error ? <span className="activity-inspection__arm-timer" aria-hidden="true" /> : null}
        </button>
      );
      break;
    case "note":
    case "banner":
      actions = (
        <>
          {pending ? (
            <button type="button" className="activity-inspection__bar-action activity-inspection__cancel" disabled={busy} onClick={cancel}>
              {t("common.cancel")}
            </button>
          ) : null}
          {confirmInPlace()}
        </>
      );
      break;
    case "steady":
      actions = confirmInPlace(pending && !error ? hint : undefined);
      break;
    case "popover":
      actions = opener;
      break;
    case "panel":
      // The question and its buttons take the panel body; the bar waits empty.
      actions = pending ? null : opener;
      break;
    case "hold":
      actions = (
        <HoldToDeleteButton
          buttonRef={requestRef}
          label={deleteText}
          ariaLabel={deleteLabel}
          describedBy={hintId}
          disabled={busy || (pending ? Boolean(deletion?.confirmDisabled) : !canDelete)}
          pending={pending}
          busy={busy}
          onHoldStart={() => setHoldHint(false)}
          onLetGoEarly={() => setHoldHint(true)}
          onHeld={deleteNow}
        />
      );
      break;
    case "undo":
      actions = (
        <button
          ref={requestRef}
          type="button"
          className="activity-inspection__bar-action activity-inspection__delete"
          data-delete-request
          aria-label={deleteLabel}
          aria-busy={busy}
          disabled={busy || (pending ? Boolean(deletion?.confirmDisabled) : !canDelete)}
          onClick={deleteNow}
        >
          <TrashIcon />
          {pending ? <ActionLabel busy={busy}>{deleteText}</ActionLabel> : <span>{deleteText}</span>}
        </button>
      );
      break;
  }

  const srHint = (deleteStyle === "timer" || deleteStyle === "steady") && pending && !error
    ? <span className="sr-only" id={hintId}>{hint}</span>
    : noted
      ? <span className="sr-only" id={hintId}>{noteDetail}</span>
    : deleteStyle === "hold"
      ? <span className="sr-only" id={hintId}>{t("dashboard.activityDetail.holdToDelete")}</span>
      : null;

  return (
    <>
      <span ref={edgeRef} className="activity-inspection__content-edge" aria-hidden="true" />
      <div
        ref={footerRef}
        className="activity-inspection__footer"
        data-style={deleteStyle}
        data-armed={pending || undefined}
        data-reached={reaches || undefined}
      >
        {lead}
        <div className="activity-inspection__bar-actions">{actions}</div>
        {deleteStyle === "popover" && pending ? (
          <div ref={cardRef} className="activity-inspection__confirm-card" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={hintId}>
            <strong id={titleId}>{t("dashboard.week.inspector.deleteTitle")}</strong>
            <p id={hintId}>{warning}</p>
            {error ? (
              <p className="week-activity-inspector__error" role="alert" title={error.detail ?? error.message}>
                {error.message}
                {error.detail ? <span className="sr-only"> {error.detail}</span> : null}
              </p>
            ) : null}
            <div className="activity-inspection__confirm-actions">
              <button type="button" className="app-btn app-btn--secondary" data-delete-cancel disabled={busy} onClick={cancel}>
                {t("common.cancel")}
              </button>
              <button type="button" className="app-btn app-btn--danger" data-delete-confirm disabled={deletion?.confirmDisabled} aria-busy={busy} onClick={confirm}>
                <ActionLabel busy={busy} busyLabel={t("common.deleting")}>{deleteText}</ActionLabel>
              </button>
            </div>
          </div>
        ) : null}
        {srHint}
      </div>
    </>
  );
}
