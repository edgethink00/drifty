// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  authorizeGoogleCalendar,
  disconnectGoogleCalendar,
  discardPendingGoogleCalendarConnection,
  finalizeGoogleCalendarConnection,
  getGoogleCalendarEvents,
  getGoogleCalendarStatus,
  hasLocalGoogleCalendarConnectionMarker,
  isGoogleCalendarAuthorizationCancelled,
} from "./googleCalendarClient";

describe("googleCalendarClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps sign-in identity tokens scoped to the sign-in result", async () => {
    invokeMock.mockResolvedValue({
      attemptId: "attempt-1",
      purpose: "signIn",
      calendarGranted: true,
      calendarCredentialReady: true,
      connectedEmail: "person@example.com",
      googleSubject: "google-subject",
      idToken: "id-token",
      accessToken: "access-token",
    });

    await expect(authorizeGoogleCalendar("signIn")).resolves.toMatchObject({
      calendarGranted: true,
      idToken: "id-token",
    });
    expect(invokeMock).toHaveBeenCalledWith("google_calendar_authorize", { purpose: "signIn" });
  });

  it("rejects identity tokens exposed by a calendar-only connection", async () => {
    invokeMock.mockResolvedValue({
      attemptId: "attempt-2",
      purpose: "connect",
      calendarGranted: true,
      calendarCredentialReady: true,
      connectedEmail: "person@example.com",
      googleSubject: "google-subject",
      idToken: "must-not-cross",
      accessToken: null,
    });

    await expect(authorizeGoogleCalendar("connect")).rejects.toThrow(
      "exposed unexpected identity tokens",
    );
  });

  it("finalizes and discards pending credentials by opaque attempt id", async () => {
    invokeMock
      .mockResolvedValueOnce({
        configured: true,
        connected: true,
        connectedEmail: "person@example.com",
        grantedScopes: ["openid", "https://www.googleapis.com/auth/calendar.events.owned.readonly"],
      })
      .mockResolvedValueOnce(undefined);

    await expect(finalizeGoogleCalendarConnection("user-id", "attempt-id", "signIn")).resolves.toMatchObject({
      connected: true,
    });
    await discardPendingGoogleCalendarConnection("attempt-id");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "google_calendar_finalize", {
      userId: "user-id",
      attemptId: "attempt-id",
      purpose: "signIn",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "google_calendar_discard_pending", {
      attemptId: "attempt-id",
    });
  });

  it("parses bounded status and minimal event DTOs", async () => {
    invokeMock
      .mockResolvedValueOnce({
        configured: true,
        connected: false,
        connectedEmail: null,
        grantedScopes: [],
      })
      .mockResolvedValueOnce([
        {
          id: "event-1",
          title: "Planning",
          start: "2026-09-02T01:00:00Z",
          end: "2026-09-02T02:00:00Z",
          allDay: false,
        },
      ]);

    await expect(getGoogleCalendarStatus("user-id")).resolves.toMatchObject({ connected: false });
    await expect(
      getGoogleCalendarEvents("user-id", "2026-09-01T00:00:00Z", "2026-09-08T00:00:00Z"),
    ).resolves.toEqual([
      expect.objectContaining({ id: "event-1", title: "Planning", allDay: false }),
    ]);
  });

  it("marks only confirmed connections so existing users avoid unrelated Keychain access", async () => {
    expect(hasLocalGoogleCalendarConnectionMarker("existing-user")).toBe(false);
    invokeMock.mockResolvedValue({
      configured: true,
      connected: true,
      connectedEmail: "person@example.com",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned.readonly"],
    });

    await getGoogleCalendarStatus("connected-user");

    expect(hasLocalGoogleCalendarConnectionMarker("existing-user")).toBe(false);
    expect(hasLocalGoogleCalendarConnectionMarker("connected-user")).toBe(true);

    invokeMock.mockResolvedValue({
      configured: true,
      connected: false,
      connectedEmail: null,
      grantedScopes: [],
    });
    await disconnectGoogleCalendar("connected-user");
    expect(hasLocalGoogleCalendarConnectionMarker("connected-user")).toBe(false);
  });

  it("rolls back a saved credential if its account-deletion marker cannot be persisted", async () => {
    invokeMock
      .mockResolvedValueOnce({
        configured: true,
        connected: true,
        connectedEmail: "person@example.com",
        grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned.readonly"],
      })
      .mockResolvedValueOnce({
        configured: true,
        connected: false,
        connectedEmail: null,
        grantedScopes: [],
      });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    await expect(
      finalizeGoogleCalendarConnection("user-id", "attempt-id", "connect"),
    ).rejects.toThrow(/rolled back/i);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "google_calendar_finalize", {
      userId: "user-id",
      attemptId: "attempt-id",
      purpose: "connect",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "google_calendar_disconnect", {
      userId: "user-id",
    });

    setItem.mockRestore();
  });

  it("recognizes cancellation without treating every native error as cancellation", () => {
    expect(isGoogleCalendarAuthorizationCancelled("GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED")).toBe(true);
    expect(isGoogleCalendarAuthorizationCancelled("GOOGLE_CALENDAR_TOKEN_EXCHANGE_FAILED")).toBe(false);
  });
});
