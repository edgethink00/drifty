// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PostOnboardingSidebarGuide } from "./PostOnboardingSidebarGuideOverlay";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const callbacks = () => ({ onAdvance: vi.fn(), onBack: vi.fn(), onDismiss: vi.fn() });

describe("centered app introduction", () => {
  it("opens without sidebar anchors, shows dots instead of a numeric counter, and keeps the same dialog between pages", () => {
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Welcome to Drifty" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(document.querySelectorAll(".post-onboarding-sidebar-guide__dots i")).toHaveLength(5);
    expect(document.querySelectorAll(".post-onboarding-sidebar-guide__dots i[data-active]")).toHaveLength(1);
    expect(screen.queryByText(/\d\s*\/\s*\d/)).toBeNull();
    expect(document.querySelector(".post-onboarding-sidebar-guide__brand")).toBeNull();
    rerender(<PostOnboardingSidebarGuide step="tracking" {...props} />);
    expect(screen.getByRole("dialog", { name: "Still here in the menu bar" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(false);
  });

  it("localizes copy and handles next, back, skip and Escape", () => {
    const props = callbacks();
    render(<LocalizationTestProvider language="ko"><PostOnboardingSidebarGuide step="account" {...props} /></LocalizationTestProvider>);
    expect(screen.getByRole("dialog", { name: "딴짓을 닫아주는 고양이" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onAdvance).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledOnce();
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("uses the active navigation's destinations in the correction page", () => {
    render(<PostOnboardingSidebarGuide step="activity" {...callbacks()} navigationRefreshEnabled />);
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toMatch(/Use Insights to see patterns and History/);
  });

  it("traps focus inside the intro and restores app interaction and focus after removal", async () => {
    const app = document.createElement("div");
    app.className = "app-shell";
    const trigger = document.createElement("button");
    app.append(trigger); document.body.append(app); trigger.focus();
    try {
      const { unmount } = render(<PostOnboardingSidebarGuide step="day" {...callbacks()} />);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" })));
      expect(app.inert).toBe(true);
      fireEvent.keyDown(window, { key: "Tab" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
      fireEvent.keyDown(window, { key: "Tab" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
      fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
      unmount();
      expect(app.inert).toBeFalsy();
      expect(document.activeElement).toBe(trigger);
    } finally { app.remove(); }
  });

  it("uses a useful first action and lets the user skip the introduction", () => {
    const props = callbacks();
    render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(props.onAdvance).toHaveBeenCalledOnce();
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("describes Windows system tray without macOS menu-bar or Dock artwork", () => {
    render(<PostOnboardingSidebarGuide step="tracking" hostPlatform="windows" {...callbacks()} />);
    expect(screen.getByRole("dialog", { name: "Still here in the system tray" })).toBeTruthy();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toMatch(/system tray/);
    expect(document.querySelector("[data-art-scene]")?.getAttribute("data-platform")).toBe("windows");
    expect(document.querySelector(".real-art__dock")).toBeNull();
    expect(document.body.textContent).not.toMatch(/menu bar/);
  });

  it("keeps Windows welcome and tracking artwork platform-neutral in dark mode", () => {
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" hostPlatform="windows" theme="dark" {...props} />);
    expect(document.querySelector("[data-art-scene]")?.getAttribute("data-art-theme")).toBe("dark");
    expect(document.querySelector(".real-art__dock")).toBeNull();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toMatch(/system tray/);
    rerender(<PostOnboardingSidebarGuide step="tracking" hostPlatform="windows" theme="dark" {...props} />);
    expect(document.querySelector(".real-art__dock")).toBeNull();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toMatch(/system tray/);
  });

  it("switches the native-ring illustration with the app theme without replacing the dialog", () => {
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="tracking" theme="light" {...props} />);
    const dialog = screen.getByRole("dialog");
    expect(document.querySelector("[data-art-scene]")?.getAttribute("data-art-theme")).toBe("light");
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toMatch(/ring shows your focus, drift and neutral time/);
    rerender(<PostOnboardingSidebarGuide step="tracking" theme="dark" {...props} />);
    expect(document.querySelector("[data-art-scene]")?.getAttribute("data-art-theme")).toBe("dark");
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("does not dismiss on a background click and preserves the macOS drag strip", () => {
    const props = callbacks();
    render(<PostOnboardingSidebarGuide step="day" {...props} />);
    fireEvent.click(document.querySelector(".post-onboarding-sidebar-guide__scrim")!);
    expect(props.onDismiss).not.toHaveBeenCalled();
    expect(document.querySelector(".post-onboarding-sidebar-guide__drag-strip")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("dismisses on Escape and provides a clear final action", () => {
    const props = callbacks();
    render(<PostOnboardingSidebarGuide step="tracking" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Start using Drifty" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onAdvance).toHaveBeenCalledOnce();
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("supports arrow navigation without hijacking Enter on buttons", () => {
    const props = callbacks();
    render(<PostOnboardingSidebarGuide step="tracking" {...props} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Back" }), { key: "Enter" });
    expect(props.onAdvance).toHaveBeenCalledTimes(2);
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("fades out after closing and ignores keys during the exit", () => {
    vi.useFakeTimers();
    try {
      const props = callbacks();
      const { rerender } = render(<PostOnboardingSidebarGuide step="account" {...props} />);
      rerender(<PostOnboardingSidebarGuide step={null} {...props} />);
      expect(document.querySelector(".post-onboarding-sidebar-guide")?.getAttribute("data-phase")).toBe("exiting");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(props.onDismiss).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector(".post-onboarding-sidebar-guide")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("removes immediately when reduced motion is enabled", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="day" {...props} />);
    rerender(<PostOnboardingSidebarGuide step={null} {...props} />);
    expect(document.querySelector(".post-onboarding-sidebar-guide")).toBeNull();
  });

  it("keeps focus and the dialog while only the current page is exposed during a transition", () => {
    vi.useFakeTimers();
    try {
      const props = callbacks();
      const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
      const dialog = screen.getByRole("dialog");
      const next = screen.getByRole("button", { name: "Show me around" });
      next.focus();
      rerender(<PostOnboardingSidebarGuide step="day" {...props} />);
      expect(screen.getByRole("dialog", { name: "Where your day adds up" })).toBe(dialog);
      expect(document.activeElement).toBe(next);
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(document.querySelectorAll("#post-onboarding-sidebar-guide-title")).toHaveLength(1);
      const previous = document.querySelector<HTMLElement>(".post-onboarding-sidebar-guide__copy-previous")!;
      expect(previous.getAttribute("aria-hidden")).toBe("true");
      expect(previous.inert).toBe(true);
      act(() => { vi.advanceTimersByTime(300); });
      expect(document.querySelector(".post-onboarding-sidebar-guide__copy-previous")).toBeNull();
      expect(document.querySelector(".post-onboarding-sidebar-guide__visual-page--previous")).toBeNull();
      expect(document.activeElement).toBe(next);
    } finally { vi.useRealTimers(); }
  });

  it("settles on the latest page after rapid next/back reversals without leaving stale layers", () => {
    vi.useFakeTimers();
    try {
      const props = callbacks();
      const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
      rerender(<PostOnboardingSidebarGuide step="day" {...props} />);
      act(() => { vi.advanceTimersByTime(100); });
      rerender(<PostOnboardingSidebarGuide step="activity" {...props} />);
      rerender(<PostOnboardingSidebarGuide step="day" {...props} />);
      expect(screen.getAllByRole("heading")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Where your day adds up" })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(170); });
      expect(document.querySelector(".post-onboarding-sidebar-guide__copy-previous")).not.toBeNull();
      act(() => { vi.advanceTimersByTime(100); });
      expect(document.querySelector(".post-onboarding-sidebar-guide__copy-previous")).toBeNull();
      expect(document.querySelectorAll("[data-art-scene]")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Where your day adds up" })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("switches pages directly without retaining an outgoing layer in reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
    rerender(<PostOnboardingSidebarGuide step="day" {...props} />);
    expect(screen.getByRole("dialog", { name: "Where your day adds up" })).toBeTruthy();
    expect(document.querySelector(".post-onboarding-sidebar-guide__copy-previous")).toBeNull();
    expect(document.querySelectorAll("[data-art-scene]")).toHaveLength(1);
  });

  it("keeps the shipped card order and leaves the Automatic close card on its result while paging away", () => {
    vi.useFakeTimers();
    try {
      const props = callbacks();
      const { rerender } = render(<PostOnboardingSidebarGuide step="account" {...props} />);
      expect(screen.getByRole("dialog", { name: "A cat that closes the drift" })).toBeTruthy();
      expect(document.querySelectorAll(".post-onboarding-sidebar-guide__dots i")[3].hasAttribute("data-active")).toBe(true);
      rerender(<PostOnboardingSidebarGuide step="tracking" {...props} />);
      const outgoing = document.querySelector(".post-onboarding-sidebar-guide__visual-page--previous [data-pet-motion]");
      expect(outgoing?.getAttribute("data-pet-motion")).toBe("closed");
      expect(outgoing?.classList.contains("sidebar-guide-narrative-host--settled")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
