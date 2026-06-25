// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FocusDriftHoverCard } from "./FocusDriftHoverCard";
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
  windowSeconds: 30 * 60,
  focusScore: 50,
  driftScore: 50,
  topFocusSource: {
    id: "app:com.microsoft.VSCode",
    label: "Visual Studio Code",
    detail: "Mac app",
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

describe("FocusDriftHoverCard", () => {
  it("renders source icons and dense focus drift details without repeated explanation", () => {
    render(
      <FocusDriftHoverCard
        appIcons={{
          "com.google.Chrome": "data:image/png;base64,chrome",
          "com.microsoft.VSCode": "data:image/png;base64,code",
        }}
        hover={{ point: focusDriftPoint, kind: "focus", x: 20, y: 20 }}
      />,
    );

    const card = screen.getByText("12:00").closest(".focus-drift-hover-card");
    expect(card).toBeTruthy();
    if (!(card instanceof HTMLElement)) throw new Error("Expected focus drift hover card to render.");

    expect(within(card).getByText("Focus-heavy")).toBeTruthy();
    expect(within(card).getByText("30m focus")).toBeTruthy();
    expect(within(card).getByText("30m drift")).toBeTruthy();
    expect(within(card).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(card).getByText("youtube.com")).toBeTruthy();
    expect(within(card).queryByText(/makes up/i)).toBeNull();

    const appIcon = card.querySelector(".focus-drift-hover-card__source-icon .app-icon--sm");
    expect(appIcon?.getAttribute("src")).toBe("data:image/png;base64,code");

    const favicon = card.querySelector(".focus-drift-hover-card__source-icon .site-favicon");
    expect(favicon?.getAttribute("src")).toBe("https://www.google.com/s2/favicons?domain=youtube.com&sz=64");
  });
});
