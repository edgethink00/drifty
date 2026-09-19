import { useState } from "react";
import type { WatcherPeekEvent } from "./watcherPeekTypes";
import {
  PillOverflowIcon,
  PillPauseIcon,
  PillPlayIcon,
} from "./CompanionPillIcons";

/**
 * The resident capsule.
 *
 * It keeps the one useful live measure beside the controls people may need at
 * any moment. Nothing is hidden behind hover, so the native panel never has to
 * resize just because the pointer crossed it.
 *
 * Dev-only surface. This view is always mounted inside the companion window's
 * `.pill__clip`, but no shipping policy ever shows it to a user. The public
 * preference is `"menuBar" | "off"`, and `resolveEffectiveCompanionSurfacePolicy`
 * produces `"floating"` — the policy this capsule belongs to — solely when Dev
 * mode is active with the `drifty.dev.floatingCompanion` toggle on. A stored
 * `"floating"` from an older build is normalized back to `"menuBar"` on read.
 * The native side agrees: `watcher.rs` defaults to `MomentsOnly` and hides the
 * panel at rest rather than shrinking it into "a floating resident pill that
 * does not exist in this policy".
 *
 * Two consequences worth knowing before changing anything here. Its copy stays
 * English on purpose, because translating a surface no user reaches only adds
 * keys to carry. And opening
 * `auxiliary.html?driftySurface=companion` in a browser bypasses the policy gate
 * and renders this view, so a QA sweep that walks URLs will report it as if it
 * shipped — check reachability against the policy before filing anything found
 * that way.
 */

export type CollapsedKind = "total" | "streak" | "drift-grace" | "drifting" | "paused";

export type CompanionPillCollapsedState = {
  kind: CollapsedKind;
  primary: string;
  suffix: string;
};

const DRIFT_ALERT_AFTER_SECONDS = 60;
const STREAK_VISIBLE_AFTER_SECONDS = 600;

/**
 * The pill shows clock-style durations ("4:12"), not the app's prose form
 * ("4h 12m"), so the digits remain stable as the live measure changes.
 */
export function formatPillDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function resolveCollapsedState(
  event: WatcherPeekEvent | null,
  isTrackingPaused: boolean,
): CompanionPillCollapsedState {
  const focusSeconds = event?.focusSecondsToday ?? 0;
  const focusLabel = formatPillDuration(focusSeconds);

  if (isTrackingPaused) return { kind: "paused", primary: focusLabel, suffix: "paused" };

  if (event?.productivity === "drift") {
    const driftSeconds = event.durationSeconds;
    /* before the alarm fires, the countdown is the honest thing to show */
    if (driftSeconds < DRIFT_ALERT_AFTER_SECONDS) {
      return {
        kind: "drift-grace",
        primary: `0:${String(Math.max(0, DRIFT_ALERT_AFTER_SECONDS - driftSeconds)).padStart(2, "0")}`,
        suffix: "to alarm",
      };
    }
    return { kind: "drifting", primary: formatPillDuration(driftSeconds), suffix: "off track" };
  }

  /* a run only becomes worth naming once it is long enough to lose */
  const focusStrikeSeconds = event?.focusStrikeSeconds ?? event?.durationSeconds ?? 0;
  if (event?.productivity === "focus" && focusStrikeSeconds >= STREAK_VISIBLE_AFTER_SECONDS) {
    return { kind: "streak", primary: formatPillDuration(focusStrikeSeconds), suffix: "streak" };
  }

  return { kind: "total", primary: focusLabel, suffix: "focused" };
}

export function CompanionPillCollapsedView({
  state,
  isActive,
  isTrackingPaused,
  onToggleTracking,
  onOpenMenu,
}: {
  state: CompanionPillCollapsedState;
  isActive: boolean;
  isTrackingPaused: boolean;
  onToggleTracking: () => void;
  onOpenMenu: () => Promise<unknown> | unknown;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleOpenMenu = () => {
    if (isMenuOpen) return;
    setIsMenuOpen(true);
    void Promise.resolve()
      .then(onOpenMenu)
      .catch(() => undefined)
      .finally(() => setIsMenuOpen(false));
  };

  return (
    <div
      className={`view view--collapsed${isActive ? " is-active" : ""}`}
      data-view="collapsed"
      aria-hidden={!isActive}
    >
      <span className="orb"><i className="orb__pip" /></span>
      <div className="pill__summary" data-sensitive>
        <span className="pill__measure">{state.primary}</span>
        <span className="pill__divider" aria-hidden="true">·</span>
        <span className="pill__status">{state.suffix}</span>
      </div>
      <div className="peek__actions resting__actions">
        <button
          className="icon-btn"
          type="button"
          data-act="toggleTracking"
          title={isTrackingPaused ? "Resume tracking" : "Pause tracking"}
          aria-label={isTrackingPaused ? "Resume tracking" : "Pause tracking"}
          onClick={onToggleTracking}
        >
          <PillPauseIcon />
          <PillPlayIcon />
        </button>
        <button
          className="icon-btn"
          type="button"
          data-act="menuToggle"
          title="Open Companion menu"
          aria-label="Open Companion menu"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={handleOpenMenu}
        >
          <PillOverflowIcon />
        </button>
      </div>
    </div>
  );
}
