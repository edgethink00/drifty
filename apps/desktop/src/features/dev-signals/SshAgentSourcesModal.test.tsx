// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { MAX_SAVED_SSH_AGENT_SOURCES, SSH_AGENT_SOURCES_STORAGE_KEY } from "./sshAgentSourcesStorage";
import { SshAgentSourcesModal } from "./SshAgentSourcesModal";

const trackerClient = vi.hoisted(() => ({
  listSshAgentSources: vi.fn(),
  testSshAgentSource: vi.fn(),
  collectSshAgentSource: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient }));

function collected(host: string, turnsFound = 3) {
  return {
    ok: true,
    code: "collected",
    message: "Collected " + turnsFound + " agent turns.",
    host,
    providers: ["codex"],
    turnsFound,
    turnsIngested: turnsFound,
    filesScanned: 1,
    truncated: false,
  };
}

describe("SshAgentSourcesModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    trackerClient.listSshAgentSources.mockReset();
    trackerClient.testSshAgentSource.mockReset();
    trackerClient.collectSshAgentSource.mockReset();
    trackerClient.listSshAgentSources.mockResolvedValue({
      ok: true,
      code: "empty",
      message: "No literal SSH hosts were found. You can enter a custom host.",
      aliases: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists SSH config hosts with a connect action and connects nothing on open", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({
      ok: true,
      code: "found",
      message: "Found 2 SSH hosts.",
      aliases: ["gpu-server", "lab-host"],
    });

    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    const detected = await screen.findByRole("list", { name: "Hosts from SSH config" });
    expect(within(detected).getByRole("button", { name: "Connect gpu-server" })).toBeTruthy();
    expect(within(detected).getByRole("button", { name: "Connect lab-host" })).toBeTruthy();
    expect(screen.queryByLabelText("Host")).toBeNull();
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();
    expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enter a host" }));
    expect(screen.getByLabelText("Host")).toBeTruthy();
  });

  it("connects a detected host in one click: test, import 30 days, then save", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({ ok: true, code: "found", message: "Found.", aliases: ["gpu-server"] });
    trackerClient.testSshAgentSource.mockResolvedValue({ ok: true, code: "ready", message: "Ready.", host: "gpu-server" });
    let finishCollect: (value: ReturnType<typeof collected>) => void = () => undefined;
    trackerClient.collectSshAgentSource.mockImplementation(() => new Promise((resolve) => { finishCollect = resolve; }));
    const onCollected = vi.fn();
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={onCollected} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect gpu-server" }));

    const connected = await screen.findByRole("list", { name: "Saved SSH hosts" });
    await waitFor(() => expect(within(connected).getByText(/Importing the last 30 days/)).toBeTruthy());
    expect(trackerClient.testSshAgentSource).toHaveBeenCalledWith("gpu-server");
    expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("gpu-server", 30);
    expect(screen.queryByRole("button", { name: "Connect gpu-server" })).toBeNull();

    finishCollect(collected("gpu-server"));

    await waitFor(() => expect(onCollected).toHaveBeenCalledTimes(1));
    expect(within(screen.getByRole("list", { name: "Saved SSH hosts" })).getByText(/Synced just now/)).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]");
    expect(saved).toEqual([expect.objectContaining({ host: "gpu-server", turnsFound: 3 })]);
    expect(JSON.stringify(saved)).not.toContain("key");
  });

  it("keeps a failed connection on its row with retry and dismiss", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({ ok: true, code: "found", message: "Found.", aliases: ["new-worker"] });
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: false,
      code: "host_key",
      message: "This host is not trusted yet. Connect once in Terminal, verify its fingerprint, then retry.",
      host: "new-worker",
    });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect new-worker" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Connect once in Terminal");
    expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry connecting new-worker" }));
    await waitFor(() => expect(trackerClient.testSshAgentSource).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss new-worker" }));
    expect(screen.queryByRole("list", { name: "Saved SSH hosts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect new-worker" })).toBeTruthy();
  });

  it("opens the typed-host field when SSH config cannot be read", async () => {
    trackerClient.listSshAgentSources.mockRejectedValue(new Error("unreadable"));
    trackerClient.testSshAgentSource.mockResolvedValue({ ok: true, code: "ready", message: "Ready.", host: "custom-worker" });
    trackerClient.collectSshAgentSource.mockResolvedValue(collected("custom-worker"));
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    expect(await screen.findByText(/could not read your SSH config/i)).toBeTruthy();
    const input = screen.getByLabelText("Host") as HTMLInputElement;
    expect(screen.getByRole("button", { name: "Connect" })).toHaveProperty("disabled", true);
    fireEvent.change(input, { target: { value: " custom-worker " } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("custom-worker", 30));
    expect(trackerClient.testSshAgentSource).toHaveBeenCalledWith("custom-worker");
  });

  it("renders controls and connection guidance in Korean", async () => {
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: false,
      code: "host_key",
      message: "This host is not trusted yet. Connect once in Terminal, verify its fingerprint, then retry.",
      host: "new-worker",
    });
    render(
      <LocalizationTestProvider language="ko">
        <SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("dialog", { name: "SSH 소스" })).toBeTruthy();
    expect(await screen.findByText("SSH 호스트를 찾지 못했습니다. 호스트를 직접 입력할 수 있습니다.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("호스트"), { target: { value: "new-worker" } });
    fireEvent.click(screen.getByRole("button", { name: "연결" }));

    expect((await screen.findByRole("alert")).textContent).toContain("아직 신뢰하지 않은 호스트입니다");
  });

  it("localizes the browser-only SSH fallback in Korean", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({
      ok: false,
      code: "unavailable",
      message: "SSH config discovery is available in the Drifty desktop app.",
      aliases: [],
    });
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: false,
      code: "unavailable",
      message: "SSH collection is available in the Drifty desktop app.",
      host: "worker",
    });
    render(
      <LocalizationTestProvider language="ko">
        <SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(await screen.findByText("SSH 설정 검색은 Drifty 데스크톱 앱에서 사용할 수 있습니다.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("호스트"), { target: { value: "worker" } });
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    expect((await screen.findByRole("alert")).textContent).toContain("SSH 수집은 Drifty 데스크톱 앱에서 사용할 수 있습니다.");
  });

  it("does not claim continuous sync when the host cannot be saved", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({ ok: true, code: "found", message: "Found.", aliases: ["worker"] });
    trackerClient.testSshAgentSource.mockResolvedValue({ ok: true, code: "ready", message: "Ready.", host: "worker" });
    trackerClient.collectSshAgentSource.mockResolvedValue(collected("worker"));
    const onCollected = vi.fn();
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={onCollected} />);
    const connectButton = await screen.findByRole("button", { name: "Connect worker" });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    fireEvent.click(connectButton);

    expect((await screen.findByRole("alert")).textContent).toContain("Activity was collected");
    expect(onCollected).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("treats a typed host that is already connected as a sync of that row", async () => {
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "known-worker",
      lastCollectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      lastMessage: "Collected.",
      turnsFound: 2,
    }]));
    trackerClient.collectSshAgentSource.mockResolvedValue(collected("known-worker", 1));
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    const input = await screen.findByLabelText("Host");
    fireEvent.change(input, { target: { value: "Known-Worker" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("known-worker", 4));
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText("Saved SSH hosts")).getAllByRole("listitem")).toHaveLength(1);
  });

  it("blocks new connections when the saved-source limit is reached", async () => {
    const sources = Array.from({ length: MAX_SAVED_SSH_AGENT_SOURCES }, (_, index) => ({
      host: "worker-" + index,
      lastCollectedAt: "2026-09-05T10:00:00.000Z",
      lastMessage: "Collected.",
      turnsFound: 1,
    }));
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources));
    trackerClient.listSshAgentSources.mockResolvedValue({ ok: true, code: "found", message: "Found.", aliases: ["extra-worker"] });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Connect extra-worker" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Up to " + MAX_SAVED_SSH_AGENT_SOURCES + " SSH sources can be synced. Remove one before adding another.")).toBeTruthy();
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")).toEqual(sources);
  });

  it("lets a saved host sync now and removes it from future collection", async () => {
    const lastCollectedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "known-worker",
      lastCollectedAt,
      lastMessage: "Collected 2 agent turns.",
      turnsFound: 2,
    }]));
    trackerClient.collectSshAgentSource.mockResolvedValue({ ...collected("known-worker", 0), code: "empty" });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);
    const savedHosts = screen.getByLabelText("Saved SSH hosts");

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("known-worker", 4));
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Remove saved SSH host known-worker" }));
    expect(screen.queryByLabelText("Saved SSH hosts")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  it("shows each saved host's background sync state inside the dialog", async () => {
    const checkpoint = "2026-09-05T10:00:00.000Z";
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([
      { host: "busy-worker", lastCollectedAt: checkpoint, lastMessage: "Old.", turnsFound: 1 },
      { host: "broken-worker", lastCollectedAt: checkpoint, lastMessage: "Old.", turnsFound: 1 },
      { host: "quiet-worker", lastCollectedAt: checkpoint, lastMessage: "Old.", turnsFound: 1 },
    ]));
    render(
      <SshAgentSourcesModal
        onClose={vi.fn()}
        onCollected={vi.fn()}
        syncStatus={{
          autoSyncEnabled: true,
          sourceCount: 3,
          sourceHosts: ["busy-worker", "broken-worker", "quiet-worker"],
          activeHosts: ["busy-worker"],
          syncing: true,
          revision: 0,
          lastSuccessAt: null,
          lastErrorHost: "broken-worker",
          lastError: "Timed out.",
        }}
      />,
    );
    await waitFor(() => expect(trackerClient.listSshAgentSources).toHaveBeenCalledTimes(1));
    const rows = within(screen.getByLabelText("Saved SSH hosts")).getAllByRole("listitem");

    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["syncing", "error", "synced"]);
    expect(rows[0].textContent).toContain("Syncing…");
    expect(rows[1].textContent).toContain("Sync failed");
    expect(rows[2].textContent).toContain("Synced");
  });

  it("removes a host without overwriting a newer background checkpoint", async () => {
    const oldCheckpoint = "2026-09-05T10:00:00.000Z";
    const newCheckpoint = "2026-09-05T11:00:00.000Z";
    const sources = [
      { host: "first", lastCollectedAt: oldCheckpoint, lastMessage: "Old.", turnsFound: 1 },
      { host: "second", lastCollectedAt: oldCheckpoint, lastMessage: "Old.", turnsFound: 1 },
    ];
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources));
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);
    await waitFor(() => expect(trackerClient.listSshAgentSources).toHaveBeenCalledTimes(1));

    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([
      { ...sources[0], lastCollectedAt: newCheckpoint, lastMessage: "New.", turnsFound: 2 },
      sources[1],
    ]));
    fireEvent.click(screen.getByRole("button", { name: "Remove saved SSH host second" }));

    expect(JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")).toEqual([
      expect.objectContaining({ host: "first", lastCollectedAt: newCheckpoint, turnsFound: 2 }),
    ]);
  });
});
