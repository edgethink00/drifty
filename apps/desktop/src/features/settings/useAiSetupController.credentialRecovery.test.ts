// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSetupController } from "./useAiSetupController";

const native = vi.hoisted(() => ({ locked: false, saved: null as string | null, reads: 0, writes: [] as string[], hold: null as null | (() => Promise<void>), recoveries: [] as (string | null)[], recoveryHold: null as null | (() => Promise<void>), recoveryDenied: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args?: { value?: string | null }) => {
  if (cmd.endsWith("recover_api_key")) {
    native.recoveries.push(args?.value ?? null);
    if (native.recoveryHold) await native.recoveryHold();
    if (native.recoveryDenied) throw new Error("synthetic user declined");
    native.locked = false;
    if (typeof args?.value === "string") native.saved = args.value || null;
    return native.saved;
  }
  if (cmd.endsWith("load_api_key")) {
    native.reads++;
    if (native.locked) throw new Error("synthetic locked store");
    return native.saved;
  }
  if (cmd.endsWith("save_api_key") || cmd.endsWith("clear_api_key")) {
    const value = args?.value ?? "";
    native.writes.push(value);
    if (native.hold) await native.hold();
    if (native.locked) throw new Error("synthetic locked store");
    native.saved = value || null;
  }
  return null;
}) }));
vi.mock("./useAiConnectionTestRunner", () => ({ useAiConnectionTestRunner: () => ({ result: null, running: false, runningFingerprint: null, clearResult: () => {}, run: async () => {}, runAuto: async () => {} }) }));
vi.mock("./managedLocalAiClient", () => ({ getManagedLocalAiStatus: async () => { throw new Error("not used"); } }));

beforeEach(() => {
  Object.assign(native, { locked: false, saved: null, reads: 0, writes: [], hold: null, recoveries: [], recoveryHold: null, recoveryDenied: false });
  window.localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe.each([
  { provider: "openrouter_byok", field: "openRouterApiKey" },
  { provider: "self_hosted", field: "selfHostedApiKey" },
] as const)("$provider quiet credential recovery", ({ provider, field }) => {
  function mount() {
    window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({ provider }));
    return renderHook(() => useAiSetupController());
  }
  it("restores a temporarily unreadable stored key on focus without overwriting or clearing it", async () => {
    native.locked = true; native.saved = "synthetic-existing";
    const view = mount();
    await waitFor(() => expect(native.reads).toBe(1));
    await act(async () => { await Promise.resolve(); });
    expect(native.writes).toEqual([]);
    native.locked = false;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(view.result.current.localAiSetup[field]).toBe("synthetic-existing"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    expect(native.writes).toEqual([]);
    expect(window.localStorage.getItem("drifty.aiSetup.v1")).not.toContain("synthetic-existing");
  });
  it("retries the newest edit after unlock, persists it across remount and does not write on later focus", async () => {
    const view = mount();
    await waitFor(() => expect(native.reads).toBe(1));
    await act(async () => { await Promise.resolve(); });
    native.locked = true;
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-first" })));
    await waitFor(() => expect(native.writes).toEqual(["synthetic-first"]));
    if (provider === "self_hosted") await waitFor(() => expect(view.result.current.customEndpointCredentialState).toBe("error"));
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-latest" })));
    await waitFor(() => expect(native.writes).toEqual(["synthetic-first", "synthetic-latest"]));
    native.locked = false;
    // No focus: the bounded retry must recover on its own.
    await waitFor(() => expect(native.saved).toBe("synthetic-latest"), { timeout: 3_000 });
    const attempts = native.writes.length;
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { await Promise.resolve(); });
    expect(native.writes).toHaveLength(attempts);
    view.unmount();
    const next = mount();
    await waitFor(() => expect(next.result.current.localAiSetup[field]).toBe("synthetic-latest"));
  });
  it.each(["", "synthetic-before"])("orders a slow old write before the latest edit (%s), then cancels retries on unmount", async (latest) => {
    native.saved = "synthetic-before";
    const view = mount();
    await waitFor(() => expect(view.result.current.localAiSetup[field]).toBe("synthetic-before"));
    let release = () => {};
    native.hold = () => new Promise<void>(resolve => { release = resolve; });
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-slow" })));
    await waitFor(() => expect(native.writes).toEqual(["synthetic-slow"]));
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: latest })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    native.hold = null;
    await act(async () => release());
    await waitFor(() => expect(native.writes).toEqual(["synthetic-slow", latest]));
    expect(native.saved).toBe(latest || null);
    native.locked = true;
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-pending" })));
    await waitFor(() => expect(native.writes[native.writes.length - 1]).toBe("synthetic-pending"));
    view.unmount();
    const count = native.writes.length;
    act(() => window.dispatchEvent(new Event("focus")));
    await new Promise(resolve => setTimeout(resolve, 2_100));
    expect(native.writes).toHaveLength(count);
    expect(native.saved).toBe(latest || null);
  });
  it("only an explicit action recovers an unreadable key, without replacing it with empty input", async () => {
    native.locked = true; native.saved = "synthetic-existing";
    const view = mount();
    await waitFor(() => expect(view.result.current.providerCredentials[provider].state).toBe("error"));
    expect(native.recoveries).toEqual([]);
    expect(view.result.current.providerCredentials[provider].pending).toBe(false);
    await act(async () => view.result.current.providerCredentials[provider].recover());
    expect(native.recoveries).toEqual([null]);
    await waitFor(() => expect(view.result.current.localAiSetup[field]).toBe("synthetic-existing"));
    expect(native.saved).toBe("synthetic-existing");
    expect(native.writes).toEqual([]);
  });
  it("keeps failed changes unsaved until the explicit recovery action confirms the latest key", async () => {
    const view = mount();
    await waitFor(() => expect(native.reads).toBe(1));
    native.locked = true;
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-new" })));
    await waitFor(() => expect(view.result.current.providerCredentials[provider].state).toBe("error"));
    expect(view.result.current.providerCredentials[provider].pending).toBe(true);
    expect(native.recoveries).toEqual([]);
    await act(async () => view.result.current.providerCredentials[provider].recover());
    expect(native.recoveries).toEqual(["synthetic-new"]);
    await waitFor(() => expect(view.result.current.providerCredentials[provider].pending).toBe(false));
    expect(view.result.current.providerCredentials[provider].state).toBe("ready");
    expect(native.saved).toBe("synthetic-new");
  });
  it("does not repeat interactive recovery after a denial or two simultaneous clicks", async () => {
    native.locked = true; native.recoveryDenied = true;
    let release = () => {};
    native.recoveryHold = () => new Promise<void>(resolve => { release = resolve; });
    const view = mount();
    await waitFor(() => expect(view.result.current.providerCredentials[provider].state).toBe("error"));
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.providerCredentials[provider].recover(); void view.result.current.providerCredentials[provider].recover(); });
    await waitFor(() => expect(native.recoveries).toHaveLength(1));
    expect(view.result.current.providerCredentials[provider].recovering).toBe(true);
    await act(async () => { release(); await pending; });
    expect(view.result.current.providerCredentials[provider].state).toBe("error");
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2_100)); });
    expect(native.recoveries).toHaveLength(1);
    expect(native.saved).toBeNull();
  });
  it("never restores a delayed manual read over a newer edit or clear", async () => {
    native.locked = true; native.saved = "synthetic-old";
    let release = () => {};
    native.recoveryHold = () => new Promise<void>(resolve => { release = resolve; });
    const view = mount();
    await waitFor(() => expect(view.result.current.providerCredentials[provider].state).toBe("error"));
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.providerCredentials[provider].recover(); });
    await waitFor(() => expect(native.recoveries).toHaveLength(1));
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "synthetic-edit" })));
    act(() => view.result.current.setLocalAiSetup(current => ({ ...current, [field]: "" })));
    await act(async () => { release(); await pending; });
    expect(view.result.current.localAiSetup[field]).toBe("");
    await waitFor(() => expect(native.saved).toBeNull());
    expect(native.writes).toEqual([""]);
  });

});
