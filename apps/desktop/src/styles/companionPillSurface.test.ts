import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pillStyles = readFileSync(new URL("./companion-pill.css", import.meta.url), "utf8")
  .replace(/\r\n?/gu, "\n");

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pillStyles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

describe("companion pill surface", () => {
  /* The capsule's drop shadow needs roughly 36px of room below the pill. When
     the capsule filled its window edge to edge that shadow was sliced off at
     the window bounds and read as a hard grey rectangle around the rounded
     pill — the "black square" reported repeatedly against the resident pill.
     Measured in WebKit: corner alpha 28 before, 0 after. */
  it("floats the capsule inside a gutter so its shadow is never clipped", () => {
    const capsule = cssRule(".companion-pill-surface .pill");

    expect(capsule).toContain("left: auto;");
    expect(capsule).toContain("right: var(--pill-gutter-x);");
    expect(capsule).toContain("top: var(--pill-gutter-y);");
    expect(capsule).toContain("width: var(--pill-resting-width);");
    expect(capsule).toContain("height: calc(100% - var(--pill-gutter-y) * 2);");
  });

  /* WebKit rasterises a backdrop-filter against the element's own border box,
     so on a 999px-radius pill it would paint a square tile. Keeping the blur on
     the clip layer makes the filtered region follow the radius. */
  it("filters the backdrop on the clipped layer, never on the rounded capsule", () => {
    const capsule = cssRule(".companion-pill-surface .pill");
    const clip = cssRule(".companion-pill-surface .pill__clip");

    expect(capsule).not.toContain("backdrop-filter");
    expect(clip).toContain("backdrop-filter: blur(18px) saturate(1.18);");
    expect(clip).toContain("-webkit-backdrop-filter: blur(18px) saturate(1.18);");
    expect(clip).toContain("overflow: hidden;");
    expect(clip).toContain("border-radius: inherit;");
  });

  /* Dragging drops the blur so the surface stays cheap for the whole gesture.
     That override has to target whichever element actually carries the filter. */
  it("drops the blur from the layer that carries it while dragging", () => {
    const dragging = cssRule(".companion-pill-surface .pill.is-dragging .pill__clip");

    expect(dragging).toContain("backdrop-filter: none;");
    expect(dragging).toContain("-webkit-backdrop-filter: none;");
  });

  /* The gutter is one constant for every state. The native frame animates over
     280ms while this inset applies immediately, so a per-state gutter made the
     capsule lurch ~55px down and ~110px sideways as a milestone opened and then
     crawl back over the animation. */
  it("keeps one gutter for every state so the capsule cannot lurch", () => {
    const surface = cssRule(".companion-pill-surface");

    expect(surface).toContain("--pill-gutter-x: 88px;");
    expect(surface).toContain("--pill-gutter-y: 64px;");
    expect(pillStyles).not.toContain("--pill-confetti-gutter");
    expect(cssRule('.companion-pill-surface[data-state="milestone"] .pill'))
      .toContain("overflow: visible;");
  });

  it("pins resident controls while the native frame changes size", () => {
    const transition = cssRule('.companion-pill-surface .pill[data-transition] .view--collapsed');
    const right = cssRule('.companion-pill-surface .pill[data-transition][data-anchor="right"] .view--collapsed');
    const left = cssRule('.companion-pill-surface .pill[data-transition][data-anchor="left"] .view--collapsed');
    const center = cssRule('.companion-pill-surface .pill[data-transition][data-anchor="center"] .view--collapsed');

    expect(transition).toContain("width: var(--pill-resting-width);");
    expect(transition).toContain("height: var(--pill-resting-height);");
    expect(cssRule('.companion-pill-surface .pill[data-transition="opening"] .view--collapsed'))
      .toContain("transition-duration: .09s;");
    expect(cssRule('.companion-pill-surface .pill[data-transition="closing"] .view--collapsed'))
      .toContain("transition-duration: .11s;");
    expect(right).toContain("right: 0;");
    expect(left).toContain("left: 0;");
    expect(center).toContain("left: 50%;");
    expect(center).toContain("transform: translateX(-50%);");
    expect(cssRule('.companion-pill-surface .pill[data-transition="closing"] .view:not(.view--collapsed)'))
      .toContain("transition-duration: .11s;");
    const bridge = cssRule('.companion-pill-surface .pill[data-transition] .view--collapsed .pill__summary,\n.companion-pill-surface .pill[data-transition] .view--collapsed .resting__actions');
    expect(bridge).toContain("opacity: 0;");
    expect(bridge).toContain("transition-duration: .06s;");
  });

  it("animates the capsule inside a fixed right-pinned native canvas", () => {
    const pill = cssRule('.companion-pill-surface .pill');
    const transition = cssRule('.companion-pill-surface .pill[data-transition]');
    const milestone = cssRule(
      '.companion-pill-surface .pill[data-state="milestone"]',
    );

    expect(pill).toContain("left: auto;");
    expect(pill).toContain("right: var(--pill-gutter-x);");
    expect(transition).toContain("--pill-width-duration: .28s;");
    expect(transition).toContain("--pill-width-delay: 0s;");
    expect(milestone).toContain("width: 410px;");
  });

  it("keeps moment content at its final geometry while AppKit reveals it", () => {
    const transition = cssRule('.companion-pill-surface .pill[data-transition] .view:not(.view--collapsed)');
    const milestone = cssRule('.companion-pill-surface .pill[data-card-state="milestone"]');
    const reentry = cssRule('.companion-pill-surface .pill[data-card-state="reentry"]');
    const right = cssRule('.companion-pill-surface .pill[data-transition][data-anchor="right"] .view:not(.view--collapsed)');
    const center = cssRule('.companion-pill-surface .pill[data-transition][data-anchor="center"] .view:not(.view--collapsed)');

    expect(transition).toContain("width: var(--pill-card-width);");
    expect(transition).toContain("height: var(--pill-card-height);");
    expect(milestone).toContain("--pill-card-width: 410px;");
    expect(milestone).toContain("--pill-card-height: 54px;");
    expect(reentry).toContain("--pill-card-width: 410px;");
    expect(reentry).toContain("--pill-card-height: 54px;");
    expect(right).toContain("right: 0;");
    expect(center).toContain("left: 50%;");
    expect(center).toContain("transform: translateX(-50%);");
  });

  it("finishes the visual card exit before asking AppKit to collapse the panel", () => {
    const exit = cssRule('.companion-pill-surface .pill[data-moment-exiting="true"]');
    const directExit = cssRule('.companion-pill-surface .pill[data-direct-entry="true"][data-moment-exiting="true"]');

    expect(exit).toContain("pointer-events: none;");
    expect(exit).not.toContain("animation: companionMomentOut");
    expect(directExit).toContain("animation: companionMomentOut .34s cubic-bezier(.8, 0, .78, .2) both;");
    expect(pillStyles).toContain("@keyframes companionMomentOut");
    expect(pillStyles).toContain("to { opacity: 0; transform: translateY(-2px) scaleX(.06) scaleY(.06); }");
    expect(pillStyles).toContain("animation: companionMomentContentOut .16s var(--ease-in) both;");
  });

  it("choreographs drift alert copy, actions and close control as separate layers", () => {
    expect(pillStyles).toContain("@keyframes companionDriftCopyIn");
    expect(pillStyles).toContain("@keyframes companionDriftActionsIn");
    expect(pillStyles).toContain("@keyframes companionDriftCloseIn");
    expect(pillStyles).toContain("@keyframes companionDriftCopyOut");
    expect(pillStyles).toContain("--drift-actions-delay: .14s;");
  });

  it("bounds user-authored decision copy before it can displace the action row", () => {
    const title = cssRule('.companion-pill-surface :is(.view--drift, .view--nudge) .card__title');
    const summary = cssRule('.companion-pill-surface :is(.view--drift, .view--nudge) .card__sub');

    expect(title).toContain("overflow: hidden;");
    expect(title).toContain("-webkit-line-clamp: 2;");
    expect(summary).toContain("text-overflow: ellipsis;");
    expect(summary).toContain("white-space: nowrap;");
  });

  it("reveals the day review in reading order and exits it in reverse", () => {
    expect(pillStyles).toContain("@keyframes companionEodLayerIn");
    expect(pillStyles).toContain("@keyframes companionEodLayerOut");
    expect(pillStyles).toContain("--eod-summary-delay: .085s;");
    expect(pillStyles).toContain("--eod-action-delay: .185s;");
    expect(pillStyles).toContain(".view--eod.is-active .eodv12b--apps");
  });

  it("keeps the day review productivity ring clean and compact", () => {
    const donut = cssRule(".companion-pill-surface .eodv6__donut");
    const ring = cssRule(".companion-pill-surface .eodv6__ring");
    const ringRow = cssRule(".companion-pill-surface .eodv12__ringrow");
    const reviewGeometry = cssRule('.companion-pill-surface .pill[data-card-state="eod"]');
    const pendingReviewGeometry = cssRule('.companion-pill-surface .pill[data-card-state="eodPending"]');
    const compactReviewGeometry = cssRule('.companion-pill-surface .pill[data-card-state="eodCompact"]');
    const minimalReviewGeometry = cssRule('.companion-pill-surface .pill[data-card-state="eodMinimal"]');
    const compactReviewShell = cssRule('.companion-pill-surface .pill[data-state="eod"][data-eod-layout="compact"]');

    expect(donut).toContain("background: transparent;");
    expect(ring).toContain("inset: 0;");
    expect(ringRow).toContain("gap: 14px;");
    expect(ringRow).toContain("padding-top: 8px; padding-bottom: 8px;");
    expect(pillStyles).toContain(".eodv6__donut { width: 72px; height: 72px; }");
    expect(reviewGeometry).toContain("--pill-card-height: 480px;");
    expect(pendingReviewGeometry).toContain("--pill-card-width: 331px;");
    expect(pendingReviewGeometry).toContain("--pill-card-height: 300px;");
    expect(compactReviewGeometry).toContain("--pill-card-width: 310px;");
    expect(compactReviewGeometry).toContain("--pill-card-height: 284px;");
    expect(minimalReviewGeometry).toContain("--pill-card-width: 310px;");
    expect(minimalReviewGeometry).toContain("--pill-card-height: 223px;");
    expect(compactReviewShell).toContain("width: 310px;");
    expect(pillStyles).toContain('.pill[data-eod-layout="compact"] .view--eod .eodv12b--apps { display: none; }');
    expect(pillStyles).toContain('.pill[data-eod-version="minimal"] .view--eod .eodv12__duo { display: none; }');
  });

  it("reserves the warm warning surface for an ended Pro trial", () => {
    const pending = cssRule(".companion-pill-surface .eodv12__pending");
    const trialEnded = cssRule('.companion-pill-surface .eodv12__pending[data-tone="trial-ended"]');

    expect(pending).toContain("background: color-mix(in srgb, var(--p-unclassified) 11%, transparent);");
    expect(trialEnded).toContain("background: color-mix(in srgb, var(--p-drift) 7%, transparent);");
    expect(trialEnded).toContain("border-color: color-mix(in srgb, var(--p-drift) 18%, transparent);");
  });

  it("connects direct menu-bar moments to the native status item", () => {
    const entryGeometry = cssRule('.companion-pill-surface .pill[data-direct-entry]');
    const pending = cssRule('.companion-pill-surface .pill[data-direct-entry="pending"]');
    const entry = cssRule('.companion-pill-surface .pill[data-direct-entry="true"]');
    const tail = cssRule('.companion-pill-surface .pill[data-direct-entry="true"]::before');

    expect(entryGeometry).toContain("transform-origin: var(--menu-anchor-x, 50%) 0;");
    expect(pending).toContain("opacity: .001;");
    expect(pending).toContain("scaleX(.06) scaleY(.06)");
    expect(pillStyles).toContain("animation-play-state: paused !important;");
    expect(entry).toContain("animation: companionMomentIn .34s cubic-bezier(.22, .8, .2, 1) both;");
    expect(tail).toContain("left: calc(var(--menu-anchor-x, 50%) - 6px);");
    expect(tail).toContain("transform: rotate(45deg);");
    expect(pillStyles).toContain("translateY(-2px) scaleX(.06) scaleY(.06)");
    expect(pillStyles).toContain("scaleX(.28) scaleY(.28)");
    expect(pillStyles).toContain("scaleX(.72) scaleY(.72)");
    expect(pillStyles).toContain("animation: companionMomentContentIn .16s var(--ease-out) .11s both;");
  });

  /* The window is larger than the capsule and a native window is rectangular,
     so the surrounding gutter must never take clicks meant for the desktop. */
  it("lets clicks through the gutter but not the capsule", () => {
    expect(pillStyles).toContain(".companion-pill-surface { pointer-events: none; }");
    expect(pillStyles).toContain(".companion-pill-surface .pill { pointer-events: auto; }");
  });

  it("optically balances pause and play without changing the shared hit target", () => {
    const button = cssRule(".companion-pill-surface .icon-btn");
    const defaultIcon = cssRule(".companion-pill-surface .icon-btn svg");
    const transportIcon = cssRule('.companion-pill-surface .icon-btn[data-act="toggleTracking"] svg');
    const overflowIcon = cssRule('.companion-pill-surface .icon-btn[data-act="menuToggle"] svg');

    expect(button).toContain("width: 24px; height: 24px;");
    expect(defaultIcon).toContain("width: 13px; height: 13px;");
    expect(transportIcon).toContain("width: 16px; height: 16px;");
    expect(overflowIcon).toContain("width: 15px; height: 15px;");
  });

  it("keeps the resting time and status labels equal after the ten-percent lift", () => {
    const measure = cssRule(".companion-pill-surface .pill__measure");
    const status = cssRule(".companion-pill-surface .pill__status");

    expect(measure).toContain("font-size: 16.1px;");
    expect(status).toContain("font-size: 16.1px;");
    expect(status).toContain("font-weight: 600;");
  });

  it("keeps milestone metrics beside the title and exposes a compact labeled CTA", () => {
    const surface = cssRule(".companion-pill-surface");
    const titleRow = cssRule(".companion-pill-surface .mile__title-row");
    const title = cssRule(".companion-pill-surface .mile__title");
    const stat = cssRule(".companion-pill-surface .mile__stat");
    const action = cssRule(".companion-pill-surface .mile__action");
    const reentryAction = cssRule(".companion-pill-surface .reentry__action");
    const dismiss = cssRule(".companion-pill-surface .card__close");
    const overflow = cssRule(".companion-pill-surface .card__more");

    expect(surface).toContain("--pill-moment-control-size: 26px;");
    expect(titleRow).toContain("align-items: baseline;");
    expect(titleRow).toContain("gap: 8px;");
    expect(title).toContain("font-size: 13px;");
    expect(stat).toContain("font-size: 13.5px;");
    expect(action).toContain("height: var(--pill-moment-control-size);");
    expect(reentryAction).toContain("height: var(--pill-moment-control-size);");
    expect(dismiss).toContain("width: var(--pill-moment-control-size); height: var(--pill-moment-control-size);");
    expect(overflow).toContain("width: var(--pill-moment-control-size); height: var(--pill-moment-control-size);");
    expect(action).toContain("padding: 0 8px;");
    expect(action).toContain("font-size: 10px;");
    expect(pillStyles).not.toContain(".mile__hit");
    expect(pillStyles).not.toContain(".mile__arrow");
  });

  it("pauses one continuous dismiss-ring animation instead of restarting it", () => {
    const countdown = cssRule(".companion-pill-surface .view[data-auto] .card__close-ring circle");
    const paused = cssRule('.companion-pill-surface .view[data-auto="paused"] .card__close-ring circle');

    expect(countdown).toContain("animation: ringCountdown var(--auto-duration, 12s) linear forwards;");
    expect(countdown).toContain("animation-play-state: running;");
    expect(paused).toContain("animation-play-state: paused;");
    expect(paused).not.toContain("animation: ringCountdown");
    expect(pillStyles).not.toContain('.view[data-auto="running"] .card__close-ring circle');
  });

  it("gives every short reading moment the same solid backing as the drift nudge", () => {
    expect(pillStyles).toContain(
      '.companion-pill-surface .pill[data-state="milestone"],\n' +
      '.companion-pill-surface .pill[data-state="reentry"],\n' +
      '.companion-pill-surface .pill[data-state="nudge"] { --pill-alpha: .93; }',
    );
    expect(pillStyles).toContain(
      '.companion-pill-surface .pill[data-state="milestone"] { --mood-color: var(--p-focus); ' +
      'background: color-mix(in srgb, var(--p-focus) 5%, rgba(var(--pill-rgb), var(--pill-alpha, .82))); }',
    );
  });
});
