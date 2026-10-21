import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject, type SVGProps } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import type { DescribedActionError } from "../../lib/actionErrors";
import { useLocalization } from "../localization/LocalizationContext";

/** Same disarm window as the app's other two-press deletes (Team, history). */
export const FOOTER_ARM_MS = 3000;
/** A second press this soon after arming is a double-click, not a decision. */
export const FOOTER_ARM_GUARD_MS = 350;

export type PanelFooterDeletion = {
  /** True while the delete waits for its second press. */
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

/**
 * Panel placement: a bar pinned to the bottom of the column with one height.
 * The block's name is renamed where it is shown, so delete is the bar's one
 * action, and the bar draws its divider only while content reaches it. Delete
 * waits for a second press in place: only its own spot turns into a solid
 * "Confirm" for three seconds, with the count and the warning in its tooltip.
 */
export function ActivityPanelFooter({ deleteLabel, canDelete, onDelete, deletion }: ActivityPanelFooterProps) {
  const { t } = useLocalization();
  const hintId = useId();
  const pending = deletion?.pending ?? false;
  const busy = deletion?.busy ?? false;
  const error = deletion?.error ?? null;
  const { requestRef, footerRef } = useReturnFocus(pending);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const reaches = useContentReachesBar(footerRef, edgeRef, Boolean(onDelete));
  useArmedWindow(pending && !busy && !error, FOOTER_ARM_MS, () => deletion?.onCancel());
  const ready = useArmedReady(pending);
  if (!onDelete) return null;
  const hint = deletion
    ? t("dashboard.activityDetail.deleteArmed", { records: deletion.records }) + " · " + t("dashboard.activityDetail.cannotUndo")
    : "";
  return (
    <>
      <span ref={edgeRef} className="activity-inspection__content-edge" aria-hidden="true" />
      <div ref={footerRef} className="activity-inspection__footer" data-armed={pending || undefined} data-reached={reaches || undefined}>
        {pending && error ? <FooterError error={error} /> : <span />}
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
          onClick={pending ? (ready ? deletion?.onConfirm : undefined) : onDelete}
        >
          <TrashIcon />
          {pending
            ? <ActionLabel busy={busy}>{t("dashboard.activityDetail.confirmDelete")}</ActionLabel>
            : <span>{t("common.delete")}</span>}
          {pending && !busy && !error ? <span className="activity-inspection__arm-timer" aria-hidden="true" /> : null}
        </button>
        {pending && !error ? <span className="sr-only" id={hintId}>{hint}</span> : null}
      </div>
    </>
  );
}

