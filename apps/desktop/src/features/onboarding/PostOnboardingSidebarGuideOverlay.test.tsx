// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PostOnboardingSidebarGuide } from "./PostOnboardingSidebarGuideOverlay";
import { POST_ONBOARDING_STORY_GUIDE_STEPS } from "./postOnboardingSidebarGuide";
import { buildFirstDayRecap } from "./firstDayStory";
import { buildFirstDayReviewSegments, buildIntroReviewCase } from "./introStoryReview";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const callbacks = () => ({ onAdvance: vi.fn(), onBack: vi.fn(), onDismiss: vi.fn() });

describe("centered app introduction", () => {
  const recap = buildFirstDayRecap({ segments: buildFirstDayReviewSegments("2026-09-30"), day: "2026-09-30", today: "2026-10-01" });

  it("tells the user's own first day on the story cards", () => {
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="recap" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap} {...props} />);
    expect(screen.getByRole("dialog", { name: "You focused for 4h 41m in your browser yesterday" })).toBeTruthy();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent)
      .toBe("Your longest stretch was 1h 4m on github.com, from 2:02 PM.");
    // The first story card pages on with Next; only the sample welcome offers "Show me around".
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    rerender(<PostOnboardingSidebarGuide step="drift" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap} {...props} />);
    expect(screen.getByRole("dialog", { name: "Drift in your browser took 2h 1m" })).toBeTruthy();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent)
      .toBe("Most of it went to youtube.com: 1h 12m. If some of it wasn't drift, you can correct it.");
    expect(document.querySelector("[data-art-scene='drift']")).toBeTruthy();
  });

  it("says plainly when there was almost no drift, scoped to the browser when the day was rebuilt, and looks ahead on the decision card", () => {
    const props = callbacks();
    const day = "2026-09-30", today = "2026-10-01";
    const rebuilt = buildFirstDayRecap({ ...buildIntroReviewCase("noDrift", () => day), today });
    const { rerender } = render(<PostOnboardingSidebarGuide step="drift" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={rebuilt} {...props} />);
    expect(screen.getByRole("dialog", { name: "Almost no drift in your browser" })).toBeTruthy();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toBe("From now on, time in your apps is recorded too.");
    rerender(<PostOnboardingSidebarGuide step="account" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={rebuilt}
      decision={{ autoCloseEnabled: false, petEnabled: false, onAutoCloseChange: vi.fn(), onPetChange: vi.fn() }} {...props} />);
    expect(screen.getByRole("dialog", { name: "When drift shows up" })).toBeTruthy();

    const watched = buildFirstDayRecap({ ...buildIntroReviewCase("watched", () => day), today });
    const watchedLow = buildFirstDayRecap({ segments: buildIntroReviewCase("watched", () => day).segments.filter((segment) => segment.classification?.productivity !== "drift"), day, today });
    rerender(<PostOnboardingSidebarGuide step="recap" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={watched} {...props} />);
    expect(screen.getByRole("dialog", { name: "You focused for 4h 41m yesterday" })).toBeTruthy();
    rerender(<PostOnboardingSidebarGuide step="drift" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={watchedLow} {...props} />);
    expect(screen.getByRole("dialog", { name: "A day with almost no drift" })).toBeTruthy();
    expect(document.getElementById("post-onboarding-sidebar-guide-body")?.textContent).toBe("Nothing was classified as drift.");
  });

  it("offers Automatic close and the desktop cat, never Drift alerts, and asks in a popup before closing", async () => {
    const onAutoCloseChange = vi.fn();
    const onPetChange = vi.fn();
    const props = callbacks();
    render(<PostOnboardingSidebarGuide step="account" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap}
      decision={{ autoCloseEnabled: false, petEnabled: false, onAutoCloseChange, onPetChange }} {...props} />);
    expect(screen.getByRole("dialog", { name: "When drift runs long" })).toBeTruthy();
    // First-run keeps Drift alerts a Settings choice (product decision 2026-09-22).
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText(/let me know|alert me/i)).toBeNull();
    expect(screen.getAllByRole("switch").map((control) => control.getAttribute("aria-label"))).toEqual(["Automatic close", "Show desktop cat"]);
    fireEvent.click(screen.getByRole("switch", { name: "Show desktop cat" }));
    expect(onPetChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("switch", { name: "Automatic close" }));
    const popup = await screen.findByRole("alertdialog", { name: "Turn on Automatic close?" });
    expect(onAutoCloseChange).not.toHaveBeenCalled();
    // With the cat off the preview has no cat and the body has no cat line.
    expect(popup.querySelector(".close-preview__cat")).toBeNull();
    expect(popup.textContent).not.toContain("Pet the cat");
    // The card keeps its own Back and Next behind the popup.
    expect(document.querySelector("[data-intro-next]")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(popup).getByRole("button", { name: "Keep off" })));
    // Escape keeps Automatic close off and leaves the intro open.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(props.onDismiss).not.toHaveBeenCalled();
    expect(onAutoCloseChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch", { name: "Automatic close" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Turn on" }));
    expect(onAutoCloseChange).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("lets the desktop cat close the tab in the Automatic close preview when the cat is on", async () => {
    render(<PostOnboardingSidebarGuide step="account" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap}
      decision={{ autoCloseEnabled: false, petEnabled: true, onAutoCloseChange: vi.fn(), onPetChange: vi.fn() }} {...callbacks()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Automatic close" }));
    const popup = await screen.findByRole("alertdialog", { name: "Turn on Automatic close?" });
    expect(popup.querySelector(".close-preview__cat .pet-mode-cat")).toBeTruthy();
    expect(popup.textContent).toContain("Pet the cat while it walks over to keep it open.");
  });

  it("pairs the cat tile with its switch: touching the tile turns the cat on, and a hidden cat sleeps in the picture", () => {
    const onPetChange = vi.fn();
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="account" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap}
      decision={{ autoCloseEnabled: false, petEnabled: false, onAutoCloseChange: vi.fn(), onPetChange }} {...props} />);
    const cat = screen.getByRole("button", { name: "Pet the desktop cat" });
    expect(cat.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".sidebar-guide-narrative-art__cat .pet-mode-cat--sleep")).toBeTruthy();
    fireEvent.click(cat);
    expect(onPetChange).toHaveBeenLastCalledWith(true);

    rerender(<PostOnboardingSidebarGuide step="account" sequence={POST_ONBOARDING_STORY_GUIDE_STEPS} recap={recap}
      decision={{ autoCloseEnabled: false, petEnabled: true, onAutoCloseChange: vi.fn(), onPetChange }} {...props} />);
    const shown = screen.getByRole("button", { name: "Pet the desktop cat" });
    expect(shown.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".sidebar-guide-narrative-art__cat .pet-mode-cat--sleep")).toBeNull();
    // Touching a cat that is already on only greets; it never turns the cat off.
    fireEvent.click(shown);
    expect(onPetChange).toHaveBeenCalledTimes(1);
  });

  it("opens without sidebar anchors, shows dots instead of a numeric counter, and keeps the same dialog between pages", () => {
    const props = callbacks();
    const { rerender } = render(<PostOnboardingSidebarGuide step="welcome" {...props} />);
    const dialog = screen.getByRole("dialog", { name: "Welcome to Drifty" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(document.querySelectorAll(".post-onboarding-sidebar-guide__dots i")).toHaveLength(6);
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

  it("holds the Windows titlebar's app controls but keeps its window controls while the intro is open", () => {
    const titlebar = document.createElement("header");
    titlebar.className = "windows-titlebar";
    titlebar.innerHTML = '<div class="windows-titlebar__drag-region"></div><div class="windows-titlebar__leading"><button>Sidebar</button></div>'
      + '<div class="windows-titlebar__trailing"><button>AI setup</button></div><div class="windows-caption-controls"><button>Close</button></div>';
    document.body.append(titlebar);
    const part = (selector: string) => titlebar.querySelector<HTMLElement>(selector)!;
    try {
      const { unmount } = render(<PostOnboardingSidebarGuide step="welcome" hostPlatform="windows" {...callbacks()} />);
      expect(part(".windows-titlebar__leading").inert).toBe(true);
      expect(part(".windows-titlebar__trailing").inert).toBe(true);
      expect(part(".windows-caption-controls").inert).toBeFalsy();
      expect(part(".windows-titlebar__drag-region").inert).toBeFalsy();
      unmount();
      expect(part(".windows-titlebar__leading").inert).toBeFalsy();
      expect(part(".windows-titlebar__trailing").inert).toBeFalsy();
    } finally { titlebar.remove(); }
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

  it("keeps the Windows tray badge in the hidden-icons flyout, with the app button only while the window is open", () => {
    const props = callbacks();
    const has = (selector: string) => document.querySelector(selector) !== null;
    render(<PostOnboardingSidebarGuide step="welcome" hostPlatform="windows" {...props} />);
    expect(has("[data-windows-taskbar]")).toBe(true);
    expect(has("[data-windows-taskbar-app]")).toBe(true);
    // A new install's tray icon starts in the hidden-icons flyout, so the welcome card shows it there.
    expect(has("[data-windows-tray-overflow] [data-windows-tray-badge]")).toBe(true);
    expect(document.querySelectorAll("[data-windows-tray-badge]")).toHaveLength(1);
    cleanup();
    render(<PostOnboardingSidebarGuide step="tracking" hostPlatform="windows" {...props} />);
    // The window is closed on this card, so the app button is gone; the menu opens from the badge in the
    // same flyout and uses the Windows grey hover.
    expect(has("[data-windows-taskbar-app]")).toBe(false);
    expect(has("[data-windows-tray-overflow] [data-windows-tray-badge]")).toBe(true);
    expect(document.querySelectorAll("[data-windows-tray-badge]")).toHaveLength(1);
    expect(document.querySelector("[data-tray-highlight]")?.getAttribute("data-tray-highlight")).toBe("neutral");
    cleanup();
    render(<PostOnboardingSidebarGuide step="tracking" hostPlatform="macos" {...props} />);
    expect(has("[data-windows-taskbar]")).toBe(false);
    expect(document.querySelector("[data-tray-highlight]")?.getAttribute("data-tray-highlight")).toBe("accent");
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
    render(<PostOnboardingSidebarGuide step="handoff" {...props} />);
    expect(screen.getByRole("dialog", { name: "Your day starts adding up today" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See my day" }));
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
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
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
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
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
      expect(document.querySelectorAll(".post-onboarding-sidebar-guide__dots i")[2].hasAttribute("data-active")).toBe(true);
      rerender(<PostOnboardingSidebarGuide step="activity" {...props} />);
      const outgoing = document.querySelector(".post-onboarding-sidebar-guide__visual-page--previous [data-pet-motion]");
      expect(outgoing?.getAttribute("data-pet-motion")).toBe("closed");
      expect(outgoing?.classList.contains("sidebar-guide-narrative-host--settled")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
