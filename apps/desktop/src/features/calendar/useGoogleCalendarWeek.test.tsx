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
