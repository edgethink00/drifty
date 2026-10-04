// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capability: vi.fn(),
  events: vi.fn(),
  hasConnectionMarker: vi.fn(),
  status: vi.fn(),
}));

vi.mock("./googleCalendarClient", () => ({
  GOOGLE_CALENDAR_CONNECTION_CHANGED_EVENT: "drifty:google-calendar-connection-changed",
  getGoogleCalendarCapability: mocks.capability,
  getGoogleCalendarEvents: mocks.events,
  getGoogleCalendarStatus: mocks.status,
  hasLocalGoogleCalendarConnectionMarker: mocks.hasConnectionMarker,
  isGoogleCalendarOnboardingEnabled: () => true,
}));

import { useGoogleCalendarWeek } from "./useGoogleCalendarWeek";

const baseOptions = {
  enabled: true,
  userId: "9ddf3c7c-94e1-4c3b-8e76-f7410db08033",
  startDay: "2026-08-31",
  endDay: "2026-09-06",
  startOfDayMinutes: 4 * 60,
};

describe("useGoogleCalendarWeek", () => {
  beforeEach(() => {
    mocks.capability.mockReset().mockResolvedValue({ configured: true });
    mocks.hasConnectionMarker.mockReset().mockReturnValue(true);
    mocks.status.mockReset().mockResolvedValue({
      configured: true,
      connected: true,
      connectedEmail: "person@example.com",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned.readonly"],
    });
    mocks.events.mockReset().mockResolvedValue([{
      id: "event-1",
      title: "Planning",
      start: "2026-09-02T09:00:00+09:00",
      end: "2026-09-02T10:00:00+09:00",
      allDay: false,
    }]);
  });

  afterEach(cleanup);

  it("keeps events in memory and refreshes only after an explicit connection-change signal", async () => {
    const { result } = renderHook(() => useGoogleCalendarWeek(baseOptions));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.events.get("2026-09-02")?.[0]?.title).toBe("Planning");
    expect(mocks.events).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("drifty:google-calendar-connection-changed"));
    });

    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2));
  });

  it("never exposes the previous owner's events in a render for a new account", async () => {
    const renders: Array<{ userId: string; titles: string[] }> = [];
    const { result, rerender } = renderHook(({ userId }) => {
      const state = useGoogleCalendarWeek({ ...baseOptions, userId });
      renders.push({ userId, titles: Array.from(state.events.values()).flat().map((event) => event.title) });
      return state;
    }, { initialProps: { userId: "account-a" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let resolveEvents!: (events: []) => void;
    mocks.events.mockImplementationOnce(() => new Promise<[]>((resolve) => { resolveEvents = resolve; }));
    rerender({ userId: "account-b" });
    await waitFor(() => expect(mocks.events).toHaveBeenCalledWith("account-b", expect.any(String), expect.any(String)));
    try {
      expect(result.current.status).toBe("loading");
      expect(result.current.events.size).toBe(0);
      expect(renders.filter((render) => render.userId === "account-b").every((render) => render.titles.length === 0)).toBe(true);
    } finally {
      await act(async () => { resolveEvents([]); });
    }
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(Array.from(result.current.events.values()).flat()).toHaveLength(0);
  });

  it("returns no account events on the first signed-out render", async () => {
    const signedOutTitles: string[][] = [];
    const { result, rerender } = renderHook(({ userId }: { userId: string | null }) => {
      const state = useGoogleCalendarWeek({ ...baseOptions, userId });
      if (!userId) signedOutTitles.push(Array.from(state.events.values()).flat().map((event) => event.title));
      return state;
    }, { initialProps: { userId: "account-a" as string | null } });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ userId: null });
    expect(result.current.status).toBe("disabled");
    expect(signedOutTitles.every((titles) => titles.length === 0)).toBe(true);
  });

  it("keeps the same owner's events during a connection refresh", async () => {
    const { result } = renderHook(() => useGoogleCalendarWeek(baseOptions));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const events = result.current.events;
    let resolveEvents!: (events: []) => void;
    mocks.events.mockImplementationOnce(() => new Promise<[]>((resolve) => { resolveEvents = resolve; }));

    await act(async () => { window.dispatchEvent(new Event("drifty:google-calendar-connection-changed")); });
    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2));
    try {
      expect(result.current.status).toBe("loading");
      expect(result.current.events).toBe(events);
    } finally {
      await act(async () => { resolveEvents([]); });
    }
  });

  it("ignores the previous owner's response when it arrives after the new owner's", async () => {
    let resolveOld!: (events: Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>) => void;
    mocks.events.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(({ userId }) => useGoogleCalendarWeek({ ...baseOptions, userId }),
      { initialProps: { userId: "account-a" } });
    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(1));
    rerender({ userId: "account-b" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { resolveOld([{
      id: "old", title: "Previous account", start: "2026-09-02T09:00:00+09:00", end: "2026-09-02T10:00:00+09:00", allDay: false,
    }]); });
    expect(result.current.events.get("2026-09-02")?.[0]?.title).toBe("Planning");
  });

  it("does not read the old account's credentials after a delayed capability response", async () => {
    let resolveCapability!: (value: { configured: boolean }) => void;
    mocks.capability.mockImplementationOnce(() => new Promise((resolve) => { resolveCapability = resolve; }));
    const { result, rerender } = renderHook(({ userId }) => useGoogleCalendarWeek({ ...baseOptions, userId }),
      { initialProps: { userId: "account-a" } });
    rerender({ userId: "account-b" });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => { resolveCapability({ configured: true }); });
    expect(mocks.status).not.toHaveBeenCalledWith("account-a");
    expect(mocks.events).not.toHaveBeenCalledWith("account-a", expect.any(String), expect.any(String));
  });

  it("does not call the Calendar API for disconnected or disabled surfaces", async () => {
    mocks.status.mockResolvedValue({
      configured: true,
      connected: false,
      connectedEmail: null,
      grantedScopes: [],
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useGoogleCalendarWeek({ ...baseOptions, enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.status).toBe("disconnected"));
    expect(mocks.events).not.toHaveBeenCalled();

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.status).toBe("disabled"));
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("does not touch Calendar or Keychain state for an existing unconnected user", async () => {
    mocks.hasConnectionMarker.mockReturnValue(false);

    const { result } = renderHook(() => useGoogleCalendarWeek(baseOptions));

    await waitFor(() => expect(result.current.status).toBe("disconnected"));
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
  });
});
