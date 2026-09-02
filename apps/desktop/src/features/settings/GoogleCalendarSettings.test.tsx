// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  disconnect: vi.fn(),
  discard: vi.fn(),
  finalize: vi.fn(),
  capability: vi.fn(),
  status: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    hasRequiredAccountAuth: true,
    user: { id: "9ddf3c7c-94e1-4c3b-8e76-f7410db08033" },
  }),
}));

vi.mock("../calendar/googleCalendarClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../calendar/googleCalendarClient")>();
  return {
    ...original,
    authorizeGoogleCalendar: mocks.authorize,
    disconnectGoogleCalendar: mocks.disconnect,
    discardPendingGoogleCalendarConnection: mocks.discard,
    finalizeGoogleCalendarConnection: mocks.finalize,
    getGoogleCalendarCapability: mocks.capability,
    getGoogleCalendarStatus: mocks.status,
  };
});

import { GoogleCalendarSettings } from "./GoogleCalendarSettings";

const connectedStatus = {
  configured: true,
  connected: true,
  connectedEmail: "person@example.com",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned.readonly"],
};

describe("GoogleCalendarSettings", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    mocks.authorize.mockReset();
    mocks.disconnect.mockReset();
    mocks.discard.mockReset();
    mocks.finalize.mockReset();
    mocks.capability.mockReset().mockResolvedValue({ configured: true });
    mocks.status.mockReset().mockResolvedValue({
      configured: true,
      connected: false,
      connectedEmail: null,
      grantedScopes: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("connects only after an explicit settings action and finalizes to the signed-in user", async () => {
    mocks.authorize.mockResolvedValue({
      attemptId: "attempt-1",
      purpose: "connect",
      calendarGranted: true,
      calendarCredentialReady: true,
      connectedEmail: "person@example.com",
      googleSubject: "google-subject",
      idToken: null,
      accessToken: null,
    });
    mocks.finalize.mockResolvedValue(connectedStatus);

    render(<GoogleCalendarSettings />);

    const connectButton = await screen.findByRole("button", { name: "Connect Calendar" });
    expect(mocks.authorize).not.toHaveBeenCalled();
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(mocks.authorize).toHaveBeenCalledWith("connect");
      expect(mocks.finalize).toHaveBeenCalledWith(
        "9ddf3c7c-94e1-4c3b-8e76-f7410db08033",
        "attempt-1",
        "connect",
      );
    });
    expect(await screen.findByText(/connected as person@example\.com/i)).toBeTruthy();
  });

  it("deletes the local calendar credential without signing out of Drifty", async () => {
    mocks.status.mockResolvedValue(connectedStatus);
    mocks.disconnect.mockResolvedValue({
      configured: true,
      connected: false,
      connectedEmail: null,
      grantedScopes: [],
    });

    render(<GoogleCalendarSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledWith("9ddf3c7c-94e1-4c3b-8e76-f7410db08033");
    });
    expect(await screen.findByRole("button", { name: "Connect Calendar" })).toBeTruthy();
  });
});
