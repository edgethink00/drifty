// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorization: vi.fn(),
  enabled: vi.fn(),
  events: vi.fn(),
}));

vi.mock("./macCalendarClient", () => ({
  MAC_CALENDAR_CHANGED_EVENT: "drifty:mac-calendar-changed",
  getMacCalendarAuthorization: mocks.authorization,
  getMacCalendarEvents: mocks.events,
  isMacCalendarEnabled: mocks.enabled,
}));

import { useMacCalendarWeek } from "./useMacCalendarWeek";

const options = { enabled: true, startDay: "2026-11-23", endDay: "2026-11-29", startOfDayMinutes: 0 };

describe("useMacCalendarWeek", () => {
  beforeEach(() => {
    mocks.enabled.mockReset().mockReturnValue(true);
    mocks.authorization.mockReset().mockResolvedValue("granted");
    mocks.events.mockReset().mockResolvedValue([{
      id: "mac:abc@2026-11-24T01:00:00+00:00",
      title: "Planning",
      start: "2026-11-24T01:00:00+00:00",
      end: "2026-11-24T02:00:00+00:00",
      allDay: false,
    }]);
  });

  afterEach(cleanup);

  it("reads nothing while the setting is off", async () => {
    mocks.enabled.mockReturnValue(false);
    const { result } = renderHook(() => useMacCalendarWeek(options));
    await waitFor(() => expect(result.current.status).toBe("disabled"));
    expect(mocks.authorization).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it("reads the shown week once access is granted and rereads on focus", async () => {
    const { result } = renderHook(() => useMacCalendarWeek(options));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const [day] = [...result.current.events.values()].filter((events) => events.length > 0);
    expect(day?.[0]?.title).toBe("Planning");
    expect(mocks.events).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2));
  });

  it("shows nothing when macOS access was revoked", async () => {
    mocks.authorization.mockResolvedValue("denied");
    const { result } = renderHook(() => useMacCalendarWeek(options));
    await waitFor(() => expect(result.current.status).toBe("disconnected"));
    expect(mocks.events).not.toHaveBeenCalled();
  });
});
