// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";
import { ScreenTextNotice, useScreenTextNotice } from "./ScreenTextNotice";
import { screenTextNoticed } from "./screenTextUse";

const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
const clients: ScreenContextClient[] = [];
beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.dispose()); });

function client(recording: boolean) {
  const invoke = vi.fn<ScreenContextInvoke>(async (command) => {
    if (command === "screen_context_revoke_account") return;
    if (command === "screen_context_bind_account") return { leaseId: LEASE, value: { mode: "local", expiresAtMs: Date.now() + 900_000 } };
    if (command === "screen_context_get_status") return { leaseId: LEASE, value: {
      preferences: { scope: "active_display_scene", enabled: recording, replayEnabled: true, visibleTextEnabled: false, ocrEnabled: true, allowedApps: [], intervalSeconds: 10 },
      preferencesInvalid: false, captureEnabled: recording, helperInstalled: true, globalPaused: false, ocrSupported: true, supportedApps: [],
      paused: false, running: recording, preparing: false, accepted: 0, dropped: 0, lastFailure: null, lastAcceptedAtMs: null } };
    throw new Error("Unexpected command " + command);
  });
  const value = new ScreenContextClient(invoke, true);
  value.setAccount(null);
  clients.push(value);
  return value;
}
function Host({ source }: { readonly source: ScreenContextClient }) {
  const notice = useScreenTextNotice(source, true);
  return notice.visible ? <ScreenTextNotice onDismiss={notice.dismiss} onManage={() => {}} /> : null;
}

describe("screen text notice", () => {
  it("tells someone whose recording was already on, once, and that starts the use", async () => {
    const source = client(true);
    render(<LocalizationTestProvider language="en"><Host source={source} /></LocalizationTestProvider>);
    await act(async () => { await source.connect(); });
    expect(await screen.findByText("Screen recording text now also helps classify activities")).toBeTruthy();
    expect(screenTextNoticed()).toBe(true);
    cleanup();
    const again = client(true);
    render(<LocalizationTestProvider language="en"><Host source={again} /></LocalizationTestProvider>);
    await act(async () => { await again.connect(); });
    expect(screen.queryByText("Screen recording text now also helps classify activities")).toBeNull();
  });

  it("says nothing while recording is off, so use waits until it is turned on", async () => {
    const source = client(false);
    render(<LocalizationTestProvider language="en"><Host source={source} /></LocalizationTestProvider>);
    await act(async () => { await source.connect(); });
    await waitFor(() => expect(screenTextNoticed()).toBe(false));
    expect(screen.queryByRole("status", { name: "Screen text use" })).toBeNull();
  });
});
