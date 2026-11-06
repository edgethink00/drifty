// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenContextClient } from "../screen-context/screenContextClient";
import { MEMORY_GATE_CHECKED_STORAGE_KEY, MEMORY_MAY_BE_ON_STORAGE_KEY, turnMemoryOff, useMemoryOffWhileHidden } from "./memoryBeta";

const lease = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function native(enabled: boolean) {
  let preferences = { enabled, retentionHours: 6, workSites: ["github.com"] };
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "screen_context_revoke_account") return undefined;
    if (command === "screen_context_bind_account") return { leaseId: lease, value: { mode: "local", expiresAtMs: Date.now() + 900000 } };
    if (command === "memory_get_status") return { leaseId: lease, value: { supported: true, preferences, status: null } };
    if (command === "memory_configure") { preferences = args?.preferences as typeof preferences; return { leaseId: lease, value: { saved: true } }; }
    throw new Error(command);
  });
  const client = new ScreenContextClient(invoke, true);
  client.setAccount(null);
  return { client, invoke, preferences: () => preferences };
}
const bound = (invoke: ReturnType<typeof native>["invoke"]) => invoke.mock.calls.some(([name]) => name !== "screen_context_revoke_account");
function Probe({ client, hidden }: { readonly client: ScreenContextClient; readonly hidden: boolean }) {
  useMemoryOffWhileHidden(client, hidden);
  return null;
}
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Work memory beta gate", () => {
  it("switches memory off and keeps the other choices", async () => {
    const { client, invoke, preferences } = native(true);
    await expect(turnMemoryOff(client)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("memory_configure", { preferences: { enabled: false, retentionHours: 6, workSites: ["github.com"], apps: [] }, acknowledgeExternalText: false, leaseId: lease });
    expect(preferences().enabled).toBe(false);
    const off = native(false);
    await expect(turnMemoryOff(off.client)).resolves.toBe(false);
    expect(off.invoke.mock.calls.some(([name]) => name === "memory_configure")).toBe(false);
  });
  it("checks each install once, then touches the native account only when memory may be on", async () => {
    const first = native(true);
    render(<Probe client={first.client} hidden />);
    await waitFor(() => expect(first.preferences().enabled).toBe(false));
    await waitFor(() => expect(window.localStorage.getItem(MEMORY_GATE_CHECKED_STORAGE_KEY)).toBe("1"));
    cleanup();
    const quiet = native(true);
    render(<Probe client={quiet.client} hidden />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bound(quiet.invoke)).toBe(false);
    cleanup();
    window.localStorage.setItem(MEMORY_MAY_BE_ON_STORAGE_KEY, "1");
    const open = native(true);
    render(<Probe client={open.client} hidden={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bound(open.invoke)).toBe(false);
    cleanup();
    const hidden = native(true);
    render(<Probe client={hidden.client} hidden />);
    await waitFor(() => expect(hidden.preferences().enabled).toBe(false));
    await waitFor(() => expect(window.localStorage.getItem(MEMORY_MAY_BE_ON_STORAGE_KEY)).toBeNull());
  });
});
