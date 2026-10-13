// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FocusDriftHoverCard } from "./FocusDriftHoverCard";
import { SiteIconProvider } from "../../components/SiteIconContext";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { FocusDriftPoint } from "./focusDriftChart";

const focusDriftPoint: FocusDriftPoint = {
  id: "2026-06-13-720",
  day: "2026-06-13",
  label: "12:00",
  unit: "window",
  bucketStartMinute: 720,
  isFuture: false,
  focusSeconds: 30 * 60,
  driftSeconds: 30 * 60,
  focusCaptures: 1,
  driftCaptures: 2,
  totalSeconds: 60 * 60,
  trackedSeconds: 60 * 60,
  classifiedSeconds: 60 * 60,
  unclassifiedSeconds: 0,
  windowSeconds: 30 * 60,
  focusScore: 50,
  driftScore: 50,
  topFocusSource: {
    id: "app:com.microsoft.VSCode",
    label: "Visual Studio Code",
    detail: "Desktop app",
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    siteDomain: null,
    seconds: 30 * 60,
    captures: 1,
  },
  topDriftSource: {
    id: "site:youtube.com",
    label: "youtube.com",
    detail: "Website",
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    siteDomain: "youtube.com",
    seconds: 20 * 60,
    captures: 1,
  },
  x: 42,
  focusY: 40,
  driftY: 60,
};

const appIcons = {
  "com.google.Chrome": "data:image/png;base64,chrome",
  "com.microsoft.VSCode": "data:image/png;base64,code",
};

function hoverOf(point: FocusDriftPoint, kind: "focus" | "drift" = "focus") {
  return { point, kind, markerX: 24, markerY: 40, x: 20, y: 20 } as const;
}

function renderCard(point: FocusDriftPoint, kind: "focus" | "drift" = "focus", language: "en" | "ko" = "en") {
  render(
    <LocalizationTestProvider language={language}>
      <SiteIconProvider value={{ "youtube.com": "data:image/png;base64,youtube" }}>
        <FocusDriftHoverCard appIcons={appIcons} hover={hoverOf(point, kind)} />
      </SiteIconProvider>
    </LocalizationTestProvider>,
  );
  const card = document.querySelector<HTMLElement>(".focus-drift-hover-card");
  if (!card) throw new Error("Expected focus drift hover card to render.");
  return card;
}

describe("FocusDriftHoverCard", () => {
  it("renders the slot, a verdict and one column per kind with its own top source", () => {
    const card = renderCard(focusDriftPoint);

    // The slot reads as a range so "1h tracked" is legible against its 30m window.
    expect(within(card).getByText("12:00 – 12:30 PM")).toBeTruthy();
    expect(screen.queryByText("12:00 PM")).toBeNull();
    expect(within(card).getByText("Focus-heavy")).toBeTruthy();
    expect(within(card).getByText("1h tracked")).toBeTruthy();
    // Visible Focus and Drift labels; the screen-reader line keeps the totals.
    expect(within(card).getByText("Focus")).toBeTruthy();
    expect(within(card).getByText("Drift")).toBeTruthy();
    expect(within(card).getByText("30m focus · 30m drift")).toBeTruthy();

    const focusColumn = card.querySelector(".focus-drift-hover-card__col--focus");
    const driftColumn = card.querySelector(".focus-drift-hover-card__col--drift");
    expect(within(focusColumn as HTMLElement).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(driftColumn as HTMLElement).getByText("youtube.com")).toBeTruthy();
    // The on-screen "Top focus source" caption is gone; it stays for screen readers.
    expect(within(focusColumn as HTMLElement).getByText("Top focus source").classList.contains("sr-only")).toBe(true);
    expect(within(driftColumn as HTMLElement).getByText("Top drift source").classList.contains("sr-only")).toBe(true);
    expect(within(card).queryByText(/makes up/i)).toBeNull();
    expect(card.querySelector(".focus-drift-hover-card__metrics")).toBeNull();
    expect(card.querySelector(".focus-drift-hover-card__source-row")).toBeNull();

    const appIcon = card.querySelector(".focus-drift-hover-card__source-icon .app-icon--sm");
    expect(appIcon?.getAttribute("src")).toBe("data:image/png;base64,code");

    const favicon = card.querySelector(".focus-drift-hover-card__source-icon .site-favicon");
    // Site icons come from the local cache, never from a remote URL.
    expect(favicon?.getAttribute("src")).toBe("data:image/png;base64,youtube");
  });

  it("keeps the full source detail and share available to screen readers", () => {
    const card = renderCard(focusDriftPoint);
    const group = within(card).getByRole("group", { name: "Top sources for this window" });

    expect(within(group).getByText("Desktop app · 30m · 1 capture · 100%")).toBeTruthy();
    expect(within(group).getByText("Website via Google Chrome · 20m · 1 capture · 67%")).toBeTruthy();
    // The visible meta line is a short duplicate and stays out of the a11y tree.
    const meta = card.querySelector(".focus-drift-hover-card__source-meta");
    expect(meta?.getAttribute("aria-hidden")).toBe("true");
    expect(meta?.textContent).toBe("30m · 100%");
  });

  it("highlights the column under the pointer without recolouring the verdict", () => {
    const focusHeavy: FocusDriftPoint = { ...focusDriftPoint, focusScore: 62, driftScore: 29 };
    const card = renderCard(focusHeavy, "drift");

    expect(card.classList.contains("focus-drift-hover-card--drift")).toBe(true);
    expect(card.querySelector(".focus-drift-hover-card__col--drift")?.classList.contains("is-active")).toBe(true);
    expect(card.querySelector(".focus-drift-hover-card__col--focus")?.classList.contains("is-active")).toBe(false);
    // A drift hover on a focus-heavy window must not pair a red marker with "Focus-heavy".
    const verdict = within(card).getByText("Focus-heavy");
    expect(verdict.classList.contains("focus-drift-hover-card__verdict--focus")).toBe(true);
  });

  it("names a drift-heavy window by its larger side", () => {
    const driftHeavy: FocusDriftPoint = { ...focusDriftPoint, focusScore: 10, driftScore: 80 };
    const card = renderCard(driftHeavy, "focus");

    expect(within(card).getByText("Drift-heavy").classList.contains("focus-drift-hover-card__verdict--drift")).toBe(true);
  });

  it("sizes each share bar from its score and clamps out-of-range values", () => {
    const card = renderCard({ ...focusDriftPoint, focusScore: 62, driftScore: 130 });
    const bars = card.querySelectorAll<HTMLElement>(".focus-drift-hover-card__bar i");

    expect(bars[0]?.style.getPropertyValue("--focus-drift-share")).toBe("62%");
    expect(bars[1]?.style.getPropertyValue("--focus-drift-share")).toBe("100%");
  });

  it("keeps an empty column in place when one kind has no activity", () => {
    const focusOnly: FocusDriftPoint = {
      ...focusDriftPoint,
      driftSeconds: 0,
      driftCaptures: 0,
      focusScore: 100,
      driftScore: 0,
      topDriftSource: null,
    };
    const card = renderCard(focusOnly);

    expect(card.querySelectorAll(".focus-drift-hover-card__col")).toHaveLength(2);
    const empty = card.querySelector(".focus-drift-hover-card__col--drift .focus-drift-hover-card__source--empty");
    expect(empty?.textContent).toBe("No drift activity");
    expect(empty?.getAttribute("aria-hidden")).toBe("true");
    // The labelled group is still announced for the column that has a source.
    expect(within(card).getByRole("group", { name: "Top sources for this window" })).toBeTruthy();
    expect(within(card).getByText("30m focus · 0m drift")).toBeTruthy();
  });

  it("hides the whole duo from assistive tech when neither kind has a source", () => {
    const card = renderCard({ ...focusDriftPoint, topFocusSource: null, topDriftSource: null });
    const duo = card.querySelector(".focus-drift-hover-card__duo");

    expect(duo?.getAttribute("aria-hidden")).toBe("true");
    expect(duo?.getAttribute("role")).toBeNull();
    expect(within(card).queryByRole("group")).toBeNull();
    expect(within(card).getByText("30m focus · 30m drift")).toBeTruthy();
  });

  it("follows the display language", () => {
    const card = renderCard({ ...focusDriftPoint, bucketStartMinute: 20 * 60 + 30 }, "drift", "ko");

    expect(within(card).getByText("오후 8:30 – 9:00")).toBeTruthy();
    expect(within(card).getByText("집중 우세")).toBeTruthy();
    expect(within(card).getByText("1시간 기록")).toBeTruthy();
    expect(within(card).getByText("집중")).toBeTruthy();
    expect(within(card).getByText("딴짓")).toBeTruthy();
    expect(within(card).getByText("30분 집중 · 30분 딴짓")).toBeTruthy();
    expect(within(card).getByText("주요 집중 활동")).toBeTruthy();
    expect(within(card).getByText(/데스크톱 앱 · 30분 · 캡처 1개/)).toBeTruthy();
    expect(within(card).getByText(/웹사이트 · Google Chrome · 20분 · 캡처 1개/)).toBeTruthy();
  });

  it("offsets the slot by the configured start of day", () => {
    render(
      <FocusDriftHoverCard
        appIcons={appIcons}
        hover={hoverOf({ ...focusDriftPoint, bucketStartMinute: 0 })}
        startOfDayMinutes={4 * 60}
      />,
    );

    expect(screen.getByText("4:00 – 4:30 AM")).toBeTruthy();
  });
});
