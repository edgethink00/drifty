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

  it("loads local SSH aliases on open and waits for an explicit connection action", async () => {
    trackerClient.listSshAgentSources.mockResolvedValue({
      ok: true,
      code: "found",
      message: "Found 2 SSH hosts.",
      aliases: ["gpu-server", "lab-host"],
    });

    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    const discovered = await screen.findByRole("list", { name: "Hosts from SSH config" });
    expect(trackerClient.listSshAgentSources).toHaveBeenCalledTimes(1);
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();
    expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled();

    fireEvent.click(within(discovered).getByRole("button", { name: /gpu-server/i }));

    expect((screen.getByLabelText("Host or alias") as HTMLInputElement).value).toBe("gpu-server");
    expect(within(discovered).getByRole("button", { name: /gpu-server/i }).getAttribute("aria-pressed")).toBe("true");
    expect(trackerClient.testSshAgentSource).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Collect & keep synced" })).toHaveProperty("disabled", true);
  });

  it("keeps custom entry available when SSH config cannot be read", async () => {
    trackerClient.listSshAgentSources.mockRejectedValue(new Error("unreadable"));

    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    expect(await screen.findByText(/could not read your SSH config/i)).toBeTruthy();
    const input = screen.getByLabelText("Host or alias") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom-worker" } });
    expect(input.value).toBe("custom-worker");
    expect(screen.getByRole("button", { name: "Test connection" })).not.toHaveProperty("disabled", true);
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

    expect(screen.getByRole("dialog", { name: "SSH에서 수집" })).toBeTruthy();
    expect(await screen.findByText("SSH 호스트를 찾지 못했습니다. 호스트를 직접 입력할 수 있습니다.")).toBeTruthy();
    const input = screen.getByLabelText("호스트 또는 별칭") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-worker" } });
    fireEvent.click(screen.getByRole("button", { name: "연결 테스트" }));

    expect((await screen.findByRole("alert")).textContent).toContain("아직 신뢰하지 않은 호스트입니다");
    expect(screen.getByRole("button", { name: "수집 후 계속 동기화" })).toHaveProperty("disabled", true);
  });

  it("localizes the browser-only SSH discovery fallback in Korean", async () => {
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
    fireEvent.change(screen.getByLabelText("호스트 또는 별칭"), { target: { value: "worker" } });
    fireEvent.click(screen.getByRole("button", { name: "연결 테스트" }));
    expect((await screen.findByRole("alert")).textContent).toContain("SSH 수집은 Drifty 데스크톱 앱에서 사용할 수 있습니다.");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("tests an exact host before collecting and saves it for continuous sync", async () => {
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: true,
      code: "ready",
      message: "Connection ready. Drifty has not collected any activity yet.",
      host: "gpu-server",
    });
    trackerClient.collectSshAgentSource.mockResolvedValue({
      ok: true,
      code: "collected",
      message: "Collected 3 agent turns.",
      host: "gpu-server",
      providers: ["codex"],
      turnsFound: 3,
      turnsIngested: 3,
      filesScanned: 1,
      truncated: false,
    });
    const onCollected = vi.fn();
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={onCollected} />);
    const dialog = screen.getByRole("dialog", { name: "Collect from SSH" });
    const input = within(dialog).getByLabelText("Host or alias");

    fireEvent.change(input, { target: { value: "gpu-server" } });
    expect(within(dialog).getByRole("button", { name: "Collect & keep synced" })).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(trackerClient.testSshAgentSource).toHaveBeenCalledWith("gpu-server"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Collect & keep synced" })).toHaveProperty("disabled", false));
    fireEvent.click(within(dialog).getByRole("button", { name: "Collect & keep synced" }));

    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("gpu-server", 30));
    await waitFor(() => expect(onCollected).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByText("gpu-server")).toBeTruthy();
    expect(within(dialog).getByText(/3 turns found/)).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]");
    expect(saved).toEqual([expect.objectContaining({ host: "gpu-server", turnsFound: 3 })]);
    expect(JSON.stringify(saved)).not.toContain("key");
  });

  it("keeps the host editable and gives recovery guidance when trust is missing", async () => {
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: false,
      code: "host_key",
      message: "This host is not trusted yet. Connect once in Terminal, verify its fingerprint, then retry.",
      host: "new-worker",
    });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);
    const input = screen.getByLabelText("Host or alias") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "new-worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Connect once in Terminal");
    expect(input.value).toBe("new-worker");
    expect(screen.getByRole("button", { name: "Collect & keep synced" })).toHaveProperty("disabled", true);
  });

  it("does not claim continuous sync when the saved source cannot be persisted", async () => {
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: true,
      code: "ready",
      message: "Connection ready.",
      host: "worker",
    });
    trackerClient.collectSshAgentSource.mockResolvedValue({
      ok: true,
      code: "collected",
      message: "Collected 3 agent turns.",
      host: "worker",
      providers: ["codex"],
      turnsFound: 3,
      turnsIngested: 3,
      filesScanned: 1,
      truncated: false,
    });
    const onCollected = vi.fn();
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={onCollected} />);
    fireEvent.change(screen.getByLabelText("Host or alias"), { target: { value: "worker" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Collect & keep synced" })).not.toHaveProperty("disabled", true));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Collect & keep synced" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Activity was collected");
    expect(onCollected).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("keeps existing sources when the saved-source limit is reached", async () => {
    const sources = Array.from({ length: MAX_SAVED_SSH_AGENT_SOURCES }, (_, index) => ({
      host: `worker-${index}`,
      lastCollectedAt: "2026-09-05T10:00:00.000Z",
      lastMessage: "Collected.",
      turnsFound: 1,
    }));
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources));
    trackerClient.testSshAgentSource.mockResolvedValue({
      ok: true,
      code: "ready",
      message: "Connection ready.",
      host: "extra-worker",
    });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Host or alias"), { target: { value: "extra-worker" } });
    expect(screen.getByText(`Up to ${MAX_SAVED_SSH_AGENT_SOURCES} SSH sources can be synced. Remove one before adding another.`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(trackerClient.testSshAgentSource).toHaveBeenCalledWith("extra-worker"));

    expect(screen.getByRole("button", { name: "Collect & keep synced" })).toHaveProperty("disabled", true);
    expect(trackerClient.collectSshAgentSource).not.toHaveBeenCalled();
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
    trackerClient.collectSshAgentSource.mockResolvedValue({
      ok: true,
      code: "empty",
      message: "Connected, but no recent supported agent activity was found.",
      host: "known-worker",
      providers: [],
      turnsFound: 0,
      turnsIngested: 0,
      filesScanned: 0,
      truncated: false,
    });
    render(<SshAgentSourcesModal onClose={vi.fn()} onCollected={vi.fn()} />);
    const savedHosts = screen.getByLabelText("Saved SSH hosts");

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("known-worker", 4));

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Remove saved SSH host known-worker" }));
    expect(screen.queryByLabelText("Saved SSH hosts")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")).toEqual([]);
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
    await screen.findByText(/No literal SSH hosts were found/);

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
