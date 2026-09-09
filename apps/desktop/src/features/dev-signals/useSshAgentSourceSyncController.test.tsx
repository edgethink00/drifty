// @vitest-environment jsdom

import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshAgentSourceCollectResult } from "@drifty/domain";

import {
  loadSshAgentSources,
  saveSshAgentSources,
  MAX_SAVED_SSH_AGENT_SOURCES,
  SSH_AGENT_SOURCES_STORAGE_KEY,
  upsertSshAgentSource,
} from "./sshAgentSourcesStorage";
import {
  isSshAgentSourceSyncDue,
  SSH_AGENT_AUTO_SYNC_INTERVAL_MS,
  sshAgentSourceBackfillDays,
  useSshAgentSourceSyncController,
} from "./useSshAgentSourceSyncController";

const trackerClient = vi.hoisted(() => ({
  collectSshAgentSource: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient }));

const collectedResult: SshAgentSourceCollectResult = {
  ok: true,
  code: "collected",
  message: "Collected 3 agent turns.",
  host: "worker",
  providers: ["codex"],
  turnsFound: 3,
  turnsIngested: 3,
  commitsFound: 0,
  commitsIngested: 0,
  filesScanned: 1,
  truncated: false,
};

describe("SSH agent source continuous collection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    trackerClient.collectSshAgentSource.mockReset().mockResolvedValue(collectedResult);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the saved source order when an automatic checkpoint is updated", () => {
    const sources = [
      { host: "lab-host", lastCollectedAt: "2026-09-05T10:00:00.000Z", lastMessage: "Earlier.", turnsFound: 1 },
      { host: "10.0.0.8", lastCollectedAt: "2026-09-05T11:00:00.000Z", lastMessage: "Later.", turnsFound: 2 },
    ];

    const updated = upsertSshAgentSource(sources, {
      ...sources[1],
      lastCollectedAt: "2026-09-05T12:00:00.000Z",
      turnsFound: 3,
    });

    expect(updated.map((source) => source.host)).toEqual(["lab-host", "10.0.0.8"]);
    expect(updated[1]?.turnsFound).toBe(3);
  });

  it("reports when a continuous-collection checkpoint cannot be persisted", () => {
    const source = {
      host: "worker",
      lastCollectedAt: "2026-09-05T10:00:00.000Z",
      lastMessage: "Collected.",
      turnsFound: 1,
    };
    const unavailableStorage = {
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(saveSshAgentSources([source], unavailableStorage)).toBe(false);
  });

  it("fails closed when the browser blocks access to localStorage itself", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.", "SecurityError");
    });

    expect(loadSshAgentSources()).toEqual([]);
    expect(saveSshAgentSources([{
      host: "worker",
      lastCollectedAt: new Date().toISOString(),
      lastMessage: "Collected now.",
      turnsFound: 1,
    }])).toBe(false);
  });

  it("does not silently evict an existing source when the saved-source limit is reached", () => {
    const sources = Array.from({ length: MAX_SAVED_SSH_AGENT_SOURCES }, (_, index) => ({
      host: `worker-${index}`,
      lastCollectedAt: "2026-09-05T10:00:00.000Z",
      lastMessage: "Collected.",
      turnsFound: 1,
    }));

    expect(upsertSshAgentSource(sources, { ...sources[0], host: "extra-worker" })).toEqual(sources);
  });

  it("uses a bounded overlap window after the initial 30-day collection", () => {
    const nowMs = Date.parse("2026-09-05T12:00:00.000Z");
    expect(sshAgentSourceBackfillDays("invalid", nowMs)).toBe(30);
    expect(sshAgentSourceBackfillDays("2027-09-05T12:00:00.000Z", nowMs)).toBe(30);
    expect(sshAgentSourceBackfillDays("2026-09-05T10:00:00.000Z", nowMs)).toBe(2);
    expect(sshAgentSourceBackfillDays("2026-08-30T12:00:00.000Z", nowMs)).toBe(7);
    expect(sshAgentSourceBackfillDays("2026-01-01T00:00:00.000Z", nowMs)).toBe(30);
  });

  it("paces both successful collections and transient retry attempts", () => {
    const nowMs = Date.parse("2026-09-05T12:00:00.000Z");
    const source = {
      host: "worker",
      lastCollectedAt: new Date(nowMs - SSH_AGENT_AUTO_SYNC_INTERVAL_MS).toISOString(),
      lastMessage: "Collected.",
      turnsFound: 1,
    };
    expect(isSshAgentSourceSyncDue({ source, lastAttemptAtMs: null, nowMs })).toBe(true);
    expect(isSshAgentSourceSyncDue({ source, lastAttemptAtMs: nowMs - 1_000, nowMs })).toBe(false);
  });

  it("automatically collects a saved host that is due and persists its new checkpoint", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "worker",
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }]));

    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: true }));

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("worker", 4));
    await waitFor(() => expect(hook.result.current.status.revision).toBe(1));
    const saved = JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]");
    expect(saved).toEqual([expect.objectContaining({
      host: "worker",
      turnsFound: 3,
    })]);
    expect(saved[0].lastCollectedAt).not.toBe(oldCollection);
    expect(hook.result.current.status).toMatchObject({
      autoSyncEnabled: true,
      sourceCount: 1,
      syncing: false,
      lastError: null,
    });
  });

  it("turns on the controller when a newly saved host is announced without reconnecting immediately", async () => {
    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: true }));

    act(() => {
      saveSshAgentSources([{
        host: "worker",
        lastCollectedAt: new Date().toISOString(),
        lastMessage: "Collected now.",
        turnsFound: 1,
      }]);
    });

    await waitFor(() => expect(hook.result.current.status.sourceCount).toBe(1));
    expect(hook.result.current.status.autoSyncEnabled).toBe(true);
    expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled();
  });

  it("keeps automatic collection enabled after StrictMode replays mount effects", async () => {
    const recentSource = {
      host: "worker",
      lastCollectedAt: new Date().toISOString(),
      lastMessage: "Collected now.",
      turnsFound: 1,
    };
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([recentSource]));

    renderHook(() => useSshAgentSourceSyncController({ enabled: true }), {
      wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>,
    });
    await waitFor(() => expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled());

    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      ...recentSource,
      lastCollectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    }]));
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("worker", 4));
  });

  it("refreshes saved hosts when another storage context clears localStorage", async () => {
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "worker",
      lastCollectedAt: new Date().toISOString(),
      lastMessage: "Collected now.",
      turnsFound: 1,
    }]));
    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: true }));
    await waitFor(() => expect(hook.result.current.status.sourceCount).toBe(1));

    window.localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));

    await waitFor(() => expect(hook.result.current.status.sourceCount).toBe(0));
  });

  it("rechecks a later source checkpoint before collecting it", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sources = ["first", "second"].map((host) => ({
      host,
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }));
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources));
    let resolveFirst!: (result: typeof collectedResult) => void;
    trackerClient.collectSshAgentSource.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve;
    }));

    renderHook(() => useSshAgentSourceSyncController({ enabled: true }));
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1));

    act(() => {
      saveSshAgentSources([
        sources[0],
        { ...sources[1], lastCollectedAt: new Date().toISOString() },
      ]);
    });
    await act(async () => {
      resolveFirst(collectedResult);
      await Promise.resolve();
    });

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1));
  });

  it("keeps an earlier host failure visible when a later host succeeds", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(["first", "second"].map((host) => ({
      host,
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }))));
    trackerClient.collectSshAgentSource
      .mockResolvedValueOnce({
        ...collectedResult,
        ok: false,
        code: "timeout",
        message: "First timed out.",
        host: "first",
      })
      .mockResolvedValueOnce({ ...collectedResult, host: "second" });

    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: true }));

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.status.syncing).toBe(false));
    expect(hook.result.current.status.lastError).toBe("First timed out.");
    expect(hook.result.current.status.lastErrorHost).toBe("first");
  });

  it("does not restore a source removed while its collection is in flight", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "worker",
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }]));
    let resolveCollection!: (result: typeof collectedResult) => void;
    trackerClient.collectSshAgentSource.mockReturnValue(new Promise((resolve) => {
      resolveCollection = resolve;
    }));
    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: true }));
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1));

    act(() => saveSshAgentSources([]));
    await act(async () => {
      resolveCollection(collectedResult);
      await Promise.resolve();
    });

    await waitFor(() => expect(hook.result.current.status.syncing).toBe(false));
    expect(loadSavedHosts()).toEqual([]);
  });

  it("finishes the active request but starts no later host after collection is disabled", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(["first", "second"].map((host) => ({
      host,
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }))));
    let resolveFirst!: (result: typeof collectedResult) => void;
    trackerClient.collectSshAgentSource.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const hook = renderHook(({ enabled }) => useSshAgentSourceSyncController({ enabled }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1));

    hook.rerender({ enabled: false });
    await act(async () => {
      resolveFirst({ ...collectedResult, host: "first" });
      await Promise.resolve();
    });

    await waitFor(() => expect(hook.result.current.status.syncing).toBe(false));
    expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1);
  });

  it("paces automatic retry after a manual failure", async () => {
    const oldCollection = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "worker",
      lastCollectedAt: oldCollection,
      lastMessage: "Collected previously.",
      turnsFound: 1,
    }]));
    trackerClient.collectSshAgentSource.mockResolvedValueOnce({
      ...collectedResult,
      ok: false,
      code: "timeout",
      message: "Timed out.",
    });
    const hook = renderHook(({ enabled }) => useSshAgentSourceSyncController({ enabled }), {
      initialProps: { enabled: false },
    });

    await act(async () => {
      await hook.result.current.syncHostNow("worker", 4);
    });
    hook.rerender({ enabled: true });

    await waitFor(() => expect(hook.result.current.status.autoSyncEnabled).toBe(true));
    expect(trackerClient.collectSshAgentSource).toHaveBeenCalledTimes(1);
  });

  it("exposes an in-flight manual collection for the page-level status", async () => {
    let resolveCollection!: (result: typeof collectedResult) => void;
    trackerClient.collectSshAgentSource.mockReturnValue(new Promise((resolve) => {
      resolveCollection = resolve;
    }));
    const hook = renderHook(() => useSshAgentSourceSyncController({ enabled: false }));

    let request!: Promise<SshAgentSourceCollectResult>;
    act(() => {
      request = hook.result.current.syncHostNow("worker", 30);
    });
    expect(hook.result.current.status.syncing).toBe(true);

    await act(async () => {
      resolveCollection(collectedResult);
      await request;
    });
    expect(hook.result.current.status.syncing).toBe(false);
    expect(hook.result.current.status.revision).toBe(1);
  });
});

function loadSavedHosts(): string[] {
  return JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")
    .map((source: { host: string }) => source.host);
}
