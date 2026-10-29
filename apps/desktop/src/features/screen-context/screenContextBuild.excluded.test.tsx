// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ScreenContextClient } from "./screenContextClient";
import { useScreenContextAccount } from "./useScreenContextAccount";
import { useScreenRecording, useScreenRecordingStartup } from "./useScreenRecording";
import { screenRecordingAvailable, screenRecordingUsed } from "./screenRecordingSignals";
import { DESKTOP_AUTH_SESSION_CHANGED, DESKTOP_AUTH_SESSION_CHANGING } from "../auth/desktopAuthSessionEvents";
import { resolveScreenContextBuildMode } from "../../../screenContextBuildMode";

vi.mock("./screenContextBuild", () => ({ SCREEN_CONTEXT_BUILD_ENABLED: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  vi.mocked(invoke).mockResolvedValue(true); // Existing consent and configuration cannot reopen it.
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks();
});

it("cannot bind or read evidence even when a caller explicitly asks for native access", async () => {
  const client = new ScreenContextClient(invoke, true);
  client.setAccount("5c1c587e-6327-4da4-8290-663195343c62");
  client.credentialsReady();
  expect(client.isDesktop()).toBe(false);
  expect(await client.wasConfigured()).toBe(false);
  expect(await client.screenRecordingPermitted()).toBe(false);
  await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
  await expect(client.consume("screen_context_read_evidence", {}, (value) => value, vi.fn()))
    .rejects.toThrow("screen_context_account_unavailable");
  client.dispose();
  expect(invoke).not.toHaveBeenCalled();
});

it("does no screen IPC, subscriptions or startup polling across focus, account changes and unmount", async () => {
  const hook = renderHook(({ status, userId }) => {
    const client = useScreenContextAccount(status, userId);
    useScreenRecordingStartup(client, { mac: true, trackingRunning: true });
    useScreenRecording(client);
    return client;
  }, { initialProps: { status: "authenticated", userId: "5c1c587e-6327-4da4-8290-663195343c62" } });
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event(DESKTOP_AUTH_SESSION_CHANGING));
    window.dispatchEvent(new Event(DESKTOP_AUTH_SESSION_CHANGED));
  });
  hook.rerender({ status: "loading", userId: "cbb9e134-ffbc-4384-b6b9-6b83cafbef14" });
  hook.rerender({ status: "authenticated", userId: "cbb9e134-ffbc-4384-b6b9-6b83cafbef14" });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  hook.unmount();
  expect(invoke).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("cannot restore recording availability or saved-screen controls from stale signals", () => {
  screenRecordingAvailable.set(true);
  screenRecordingUsed.set(true);
  expect(screenRecordingAvailable.get()).toBe(false);
  expect(screenRecordingUsed.get()).toBe(false);
});

it("accepts only the two explicit package modes and preserves the existing default", () => {
  expect(resolveScreenContextBuildMode(undefined)).toBe("included");
  expect(resolveScreenContextBuildMode("included")).toBe("included");
  expect(resolveScreenContextBuildMode("excluded")).toBe("excluded");
  for (const value of ["", "off", "false", "EXCLUDED", " excluded"]) {
    expect(() => resolveScreenContextBuildMode(value)).toThrow("DRIFTY_SCREEN_CONTEXT_MODE");
  }
});
