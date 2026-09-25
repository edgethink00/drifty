// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import {
  PostOnboardingSidebarGuide,
  computePostOnboardingSidebarGuideLayout,
} from "./PostOnboardingSidebarGuideOverlay";

afterEach(cleanup);

describe("PostOnboardingSidebarGuide", () => {
  it("keeps a sidebar-attached panel inside the viewport", () => {
    expect(computePostOnboardingSidebarGuideLayout({
      anchor: { left: 12, top: 680, right: 188, bottom: 760, width: 176, height: 80 },
      panelHeight: 190,
      viewportWidth: 900,
      viewportHeight: 768,
    })).toMatchObject({
      panelLeft: 202,
      panelTop: 564,
    });
  });

  it("moves the panel below the day's headline instead of covering it", () => {
    expect(computePostOnboardingSidebarGuideLayout({
      anchor: { left: 8, top: 60, right: 188, bottom: 140, width: 180, height: 80 },
      panelHeight: 160,
      viewportWidth: 1280,
      viewportHeight: 800,
      keepClear: { left: 220, top: 40, right: 640, bottom: 88, width: 420, height: 48 },
    })).toMatchObject({ panelLeft: 202, panelTop: 102 });
  });

  it("uses concise localized copy and exposes skip, back, and next actions", () => {
    const onAdvance = vi.fn();
    const onBack = vi.fn();
    const onDismiss = vi.fn();

    render(
      <LocalizationTestProvider language="ko">
        <PostOnboardingSidebarGuide
          step="tracking"
          onAdvance={onAdvance}
          onBack={onBack}
          onDismiss={onDismiss}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("이제 평소처럼 일하면 돼요")).toBeTruthy();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "가이드 건너뛰기" }));
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses Review copy for the activity step when navigation refresh is on", () => {
    render(
      <LocalizationTestProvider language="en">
        <PostOnboardingSidebarGuide
          step="activity"
          onAdvance={vi.fn()}
          onBack={vi.fn()}
          onDismiss={vi.fn()}
          navigationRefreshEnabled
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("Review labels, patterns, and the original record")).toBeTruthy();
  });

  it("positions the guide when a portal-backed anchor appears after mount", async () => {
    render(
      <PostOnboardingSidebarGuide
        step="account"
        onAdvance={vi.fn()}
        onBack={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const anchor = document.createElement("div");
    anchor.dataset.sidebarGuideAnchor = "account";
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 8,
      top: 220,
      right: 206,
      bottom: 640,
      width: 198,
      height: 420,
      x: 8,
      y: 220,
      toJSON: () => ({}),
    });
    document.body.append(anchor);

    try {
      await waitFor(() => {
        expect(document.querySelector(".post-onboarding-sidebar-guide--positioned")).toBeTruthy();
      });
    } finally {
      anchor.remove();
    }
  });

  it("reattaches when a portal-backed anchor is replaced", async () => {
    const firstAnchor = document.createElement("div");
    firstAnchor.dataset.sidebarGuideAnchor = "account";
    vi.spyOn(firstAnchor, "getBoundingClientRect").mockReturnValue({
      left: 8,
      top: 220,
      right: 206,
      bottom: 640,
      width: 198,
      height: 420,
      x: 8,
      y: 220,
      toJSON: () => ({}),
    });
    document.body.append(firstAnchor);

    render(
      <PostOnboardingSidebarGuide
        step="account"
        onAdvance={vi.fn()}
        onBack={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const guide = screen.getByRole("region").parentElement;
    await waitFor(() => {
      expect(guide?.style.getPropertyValue("--sidebar-guide-anchor-left")).toBe("8px");
    });

    firstAnchor.remove();
    await waitFor(() => {
      expect(guide?.classList.contains("post-onboarding-sidebar-guide--positioned")).toBe(false);
    });

    const replacementAnchor = document.createElement("div");
    replacementAnchor.dataset.sidebarGuideAnchor = "account";
    vi.spyOn(replacementAnchor, "getBoundingClientRect").mockReturnValue({
      left: 24,
      top: 180,
      right: 236,
      bottom: 620,
      width: 212,
      height: 440,
      x: 24,
      y: 180,
      toJSON: () => ({}),
    });
    document.body.append(replacementAnchor);

    try {
      await waitFor(() => {
        expect(guide?.style.getPropertyValue("--sidebar-guide-anchor-left")).toBe("24px");
      });
    } finally {
      replacementAnchor.remove();
    }
  });

  it("refreshes the anchor after a transform finishes without a resize", async () => {
    const anchor = document.createElement("div");
    anchor.dataset.sidebarGuideAnchor = "account";
    const rect = vi.spyOn(anchor, "getBoundingClientRect");
    const bounds = (top: number) => ({
      left: 2, top, right: 203, bottom: top + 334,
      width: 201, height: 334, x: 2, y: top, toJSON: () => ({}),
    });
    rect.mockReturnValue(bounds(366));
    document.body.append(anchor);
    try {
      render(<PostOnboardingSidebarGuide step="account"
        onAdvance={vi.fn()} onBack={vi.fn()} onDismiss={vi.fn()} />);
      const guide = screen.getByRole("region").parentElement!;
      expect(guide.parentElement).toBe(document.body);
      await waitFor(() => expect(guide.style.getPropertyValue("--sidebar-guide-anchor-top")).toBe("366px"));
      rect.mockReturnValue(bounds(370));
      fireEvent.transitionEnd(anchor, { propertyName: "transform" });
      await waitFor(() => expect(guide.style.getPropertyValue("--sidebar-guide-anchor-top")).toBe("370px"));
    } finally {
      anchor.remove();
    }
  });

  it("dismisses on Escape and labels the final action", () => {
    const onDismiss = vi.fn();
    render(
      <PostOnboardingSidebarGuide
        step="account"
        onAdvance={vi.fn()}
        onBack={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("lets keyboard users step through from the panel itself", () => {
    const onAdvance = vi.fn();
    const onBack = vi.fn();
    render(
      <PostOnboardingSidebarGuide step="tracking" onAdvance={onAdvance} onBack={onBack} onDismiss={vi.fn()} />,
    );
    const panel = screen.getByRole("region");
    expect(panel.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(panel, { key: "Enter" });
    fireEvent.keyDown(panel, { key: "ArrowRight" });
    fireEvent.keyDown(panel, { key: "ArrowLeft" });
    // Enter on a button inside the panel is that button's own click, not "next".
    fireEvent.keyDown(screen.getByRole("button", { name: "Skip guide" }), { key: "Enter" });
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps the macOS window draggable while the dim blocks clicks", async () => {
    const anchor = document.createElement("div");
    anchor.dataset.sidebarGuideAnchor = "tracking";
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 8, top: 600, right: 188, bottom: 640, width: 180, height: 40, x: 8, y: 600, toJSON: () => ({}),
    });
    document.body.append(anchor);
    try {
      render(<PostOnboardingSidebarGuide step="tracking" onAdvance={vi.fn()} onBack={vi.fn()} onDismiss={vi.fn()} />);
      await waitFor(() => expect(document.querySelector(".post-onboarding-sidebar-guide__drag-strip")).toBeTruthy());
      expect(document.querySelector(".post-onboarding-sidebar-guide__drag-strip")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    } finally {
      anchor.remove();
    }
  });

  it("fades out after closing instead of vanishing, and ignores keys meanwhile", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const { rerender } = render(
        <PostOnboardingSidebarGuide step="account" onAdvance={vi.fn()} onBack={vi.fn()} onDismiss={onDismiss} />,
      );
      rerender(<PostOnboardingSidebarGuide step={null} onAdvance={vi.fn()} onBack={vi.fn()} onDismiss={onDismiss} />);
      const guide = document.querySelector(".post-onboarding-sidebar-guide");
      expect(guide?.getAttribute("data-phase")).toBe("exiting");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector(".post-onboarding-sidebar-guide")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
