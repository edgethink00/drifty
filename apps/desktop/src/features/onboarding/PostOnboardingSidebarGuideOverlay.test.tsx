// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("uses concise localized copy and exposes skip, back, and next actions", () => {
    const onAdvance = vi.fn();
    const onBack = vi.fn();
    const onDismiss = vi.fn();

    render(
      <LocalizationTestProvider language="ko">
        <PostOnboardingSidebarGuide
          step="activity"
          onAdvance={onAdvance}
          onBack={onBack}
          onDismiss={onDismiss}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("필요할 때 더 깊게 살펴봐요")).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "가이드 건너뛰기" }));
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
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
});
