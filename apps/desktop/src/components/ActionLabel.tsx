import type { ReactNode } from "react";
import "./action-label.css";

type ActionLabelProps = {
  /** The label shown while the action is idle. */
  readonly children: ReactNode;
  /** True while the owning button's request is in flight. */
  readonly busy: boolean;
  /**
   * Text shown next to the spinner while busy. Leave it out for compact row
   * buttons: they show the spinner alone over the dimmed idle label and keep
   * their idle width and accessible name.
   */
  readonly busyLabel?: string;
  /**
   * Every other label the button can show (an armed confirmation, a "Copied"
   * state). Their widths are reserved too, so swapping never resizes the button.
   */
  readonly reserve?: readonly string[];
};

/**
 * A button label whose footprint never changes. Every label the button can show
 * is laid out invisibly in the same grid cell, so the button is always as wide
 * as its widest state; switching to the busy state swaps a spinner in place
 * instead of inserting text or a status line somewhere else in the layout.
 *
 * The spinner fades in after a short delay, so a request that settles quickly
 * (a clipboard write) does not flash.
 */
export function ActionLabel({ children, busy, busyLabel, reserve = [] }: ActionLabelProps): JSX.Element {
  return (
    <span className="action-label">
      <span className="action-label__size" aria-hidden="true">{children}</span>
      {reserve.map((label) => (
        <span key={label} className="action-label__size" aria-hidden="true">{label}</span>
      ))}
      {busyLabel ? (
        <span className="action-label__size" aria-hidden="true">
          <span className="action-label__spinner action-label__spinner--size" />
          {busyLabel}
        </span>
      ) : null}
      {busy && busyLabel ? (
        <span className="action-label__live">
          <span className="action-label__spinner" aria-hidden="true" />
          {busyLabel}
        </span>
      ) : busy ? (
        <span className="action-label__live action-label__live--quiet">
          <span className="action-label__idle">{children}</span>
          <span className="action-label__spinner" aria-hidden="true" />
        </span>
      ) : (
        <span className="action-label__live">{children}</span>
      )}
    </span>
  );
}
