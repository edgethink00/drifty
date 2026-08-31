/** Shared glyphs for the companion pill surface. */

export function PillBrandMark() {
  return (
    <svg
      className="moment-brand__mark"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.1 3.2h9.8L8 7.9zM8 8.1l4.9 4.7H3.1z" />
    </svg>
  );
}

export function PillDismissIcon() {
  return (
    <>
      <span className="card__close-ring" aria-hidden="true">
        <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.5" /></svg>
      </span>
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M2 2l8 8M10 2l-8 8" />
      </svg>
    </>
  );
}

export function PillOpenArrowIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 10.4L10.4 3.6M5.2 3.6h5.2v5.2" />
    </svg>
  );
}

export function PillFeedbackCheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.2 10.2l3 3.1 6.7-7" />
    </svg>
  );
}

export function PillCaretIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4L5 6.5 7.5 4" />
    </svg>
  );
}

export function PillTrophyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8v4.5a4 4 0 01-8 0z" />
      <path d="M6 4.2H3.6v1.4a2.6 2.6 0 002.6 2.6M14 4.2h2.4v1.4a2.6 2.6 0 01-2.6 2.6" />
      <path d="M10 11.5V14M7.2 17h5.6M8.4 14h3.2l.6 3H7.8z" />
    </svg>
  );
}

/** A plain clock: elapsed time, without refresh, power, or sleep semantics. */
export function PillReentryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="6.7" />
      <path d="M10 6.2v4.2l2.8 1.6" />
      <circle cx="10" cy="10.4" r=".7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PillMilestoneKindIcon({ kind }: { kind: "total" | "record" | "recovery" | "rank" }) {
  /* The stylesheet hides every glyph in `.mile__kind` and re-shows only the one
     matching `[data-kind-icon]` for the pill's milestone kind. Without the
     attribute the rule never matches and the mark renders empty, so each icon
     has to carry the same marker the prototype's markup used. */
  if (kind === "recovery") {
    return (
      <svg data-kind-icon="recovery" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.5 11.5V7.8A3.3 3.3 0 009.2 4.5H3.8" />
        <path d="M6.3 2L3.8 4.5 6.3 7" />
      </svg>
    );
  }
  if (kind === "rank" || kind === "record") {
    return (
      <svg data-kind-icon="rank" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.8l1.9 3.85 4.25.62-3.07 3 .72 4.23L8 11.5l-3.8 2 .72-4.23-3.07-3 4.25-.62z" />
      </svg>
    );
  }
  return (
    <svg data-kind-icon="total" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.2V8l2 1.4" />
    </svg>
  );
}

export function PillPauseIcon() {
  return (
    <svg className="icon-pause" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="4.5" y="3.5" width="2.6" height="9" rx="1" />
      <rect x="8.9" y="3.5" width="2.6" height="9" rx="1" />
    </svg>
  );
}

export function PillPlayIcon() {
  return (
    <svg className="icon-play" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 3.6l7.5 4.4L5 12.4z" />
    </svg>
  );
}

export function PillOverflowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="13" cy="8" r="1.25" />
    </svg>
  );
}
