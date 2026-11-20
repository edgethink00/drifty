// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FOCUS_AUTO_CLOSE_OFFER_STORAGE_KEY, FOCUS_SESSION_STORAGE_KEY, readFocusSessionState, resetFocusSessionForTests, type AutoCloseMode } from "./focusSession";

const shell = vi.hoisted(() => ({ handlers: new Map<string, (payload: unknown) => void>() }));

vi.mock("./focusSessionBridge", async (original) => ({
  ...(await original<typeof import("./focusSessionBridge")>()),
  publishNativeFocusSession: vi.fn(async () => undefined),
  listenToFocusSessionCardChoice: vi.fn(() => () => undefined),
  listenToShellEvent: vi.fn((event: string, handler: (payload: unknown) => void) => {
    shell.handlers.set(event, handler);
    return () => shell.handlers.delete(event);
  }),
}));

import { FocusSessionRuntime } from "./FocusSessionRuntime";
import { FOCUS_SESSION_TRAY_EVENTS } from "./focusSessionBridge";

function renderRuntime(mode: AutoCloseMode, onChange = vi.fn()) {
  render(<LocalizationTestProvider language="en">
    <FocusSessionRuntime focusSecondsToday={0} automaticCloseMode={mode} onAutomaticCloseModeChange={onChange} />
  </LocalizationTestProvider>);
  return onChange;
}

const pick30 = () => act(() => shell.handlers.get(FOCUS_SESSION_TRAY_EVENTS.start30)?.(undefined));

describe("the first session's start dialog", () => {
  beforeEach(() => {
    shell.handlers.clear();
    resetFocusSessionForTests();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(FOCUS_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(FOCUS_AUTO_CLOSE_OFFER_STORAGE_KEY);
    resetFocusSessionForTests();
  });

  it("asks before the first session starts, with Automatic close switched on, and Start chooses During sessions", () => {
    const onChange = renderRuntime("off");
    pick30();
    expect(readFocusSessionState().active).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Starting 30m of focus" });
    expect(dialog.textContent).toContain("Unsaved work may be lost");
    expect(screen.getByRole("switch", { name: "Automatic close" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
    expect(onChange).toHaveBeenCalledWith("session");
    expect(readFocusSessionState().active?.mode).toBe("single");
    expect(window.localStorage.getItem(FOCUS_AUTO_CLOSE_OFFER_STORAGE_KEY)).toBe("asked");
  });

  it("starts with it off when switched off, and does not ask again", () => {
    const onChange = renderRuntime("off");
    pick30();
    fireEvent.click(screen.getByRole("switch", { name: "Automatic close" }));
    fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(readFocusSessionState().active).not.toBeNull();
    expect(window.localStorage.getItem(FOCUS_AUTO_CLOSE_OFFER_STORAGE_KEY)).toBe("declined");
    act(() => shell.handlers.get(FOCUS_SESSION_TRAY_EVENTS.end)?.(undefined));
    pick30();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readFocusSessionState().active).not.toBeNull();
  });

  it("starts nothing on Cancel and asks again next time", () => {
    renderRuntime("off");
    pick30();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    expect(readFocusSessionState().active).toBeNull();
    expect(window.localStorage.getItem(FOCUS_AUTO_CLOSE_OFFER_STORAGE_KEY)).toBeNull();
    pick30();
    expect(screen.getByRole("dialog", { name: "Starting 30m of focus" })).toBeTruthy();
  });

  it("starts at once when Automatic close is already on", () => {
    renderRuntime("session");
    pick30();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readFocusSessionState().active).not.toBeNull();
  });
});
