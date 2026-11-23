// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  MAC_CALENDAR_CHANGED_EVENT,
  getMacCalendarAuthorization,
  isMacCalendarEnabled,
  parseMacCalendarEvents,
  requestMacCalendarAccess,
  setMacCalendarEnabled,
} from "./macCalendarClient";

describe("macCalendarClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("reports unsupported outside the desktop app without calling native code", async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await expect(getMacCalendarAuthorization()).resolves.toBe("unsupported");
    await expect(requestMacCalendarAccess()).resolves.toBe("unsupported");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("accepts only known authorization states", async () => {
    invokeMock.mockResolvedValueOnce("writeOnly").mockResolvedValueOnce("authorizedAlways");
    await expect(getMacCalendarAuthorization()).resolves.toBe("writeOnly");
    await expect(getMacCalendarAuthorization()).rejects.toThrow("invalid");
  });

  it("rejects malformed or oversized event lists", () => {
    const event = { id: "mac:abc@2026-11-24", title: "Review", start: "2026-11-24T01:00:00+00:00", end: "2026-11-24T02:00:00+00:00", allDay: false };
    expect(parseMacCalendarEvents([event])).toEqual([event]);
    expect(() => parseMacCalendarEvents([{ ...event, allDay: "no" }])).toThrow();
    expect(() => parseMacCalendarEvents([{ ...event, title: "" }])).toThrow();
    expect(() => parseMacCalendarEvents(Array.from({ length: 501 }, () => event))).toThrow();
  });

  it("stores the on/off choice locally and announces changes", () => {
    const listener = vi.fn();
    window.addEventListener(MAC_CALENDAR_CHANGED_EVENT, listener);
    expect(isMacCalendarEnabled()).toBe(false);
    setMacCalendarEnabled(true);
    expect(isMacCalendarEnabled()).toBe(true);
    setMacCalendarEnabled(false);
    expect(isMacCalendarEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(MAC_CALENDAR_CHANGED_EVENT, listener);
  });
});
