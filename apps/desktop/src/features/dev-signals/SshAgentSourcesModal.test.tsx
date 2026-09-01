// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SSH_AGENT_SOURCES_STORAGE_KEY } from "./sshAgentSourcesStorage";
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
    expect(screen.getByRole("button", { name: "Collect & save" })).toHaveProperty("disabled", true);
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

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("tests an exact host before collecting and saves only the manual shortcut", async () => {
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
    expect(within(dialog).getByRole("button", { name: "Collect & save" })).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(trackerClient.testSshAgentSource).toHaveBeenCalledWith("gpu-server"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Collect & save" })).toHaveProperty("disabled", false));
    fireEvent.click(within(dialog).getByRole("button", { name: "Collect & save" }));

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
    expect(screen.getByRole("button", { name: "Collect & save" })).toHaveProperty("disabled", true);
  });

  it("collects saved hosts only on demand and removes only the saved shortcut", async () => {
    window.localStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify([{
      host: "known-worker",
      lastCollectedAt: "2026-09-01T01:00:00.000Z",
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

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Collect" }));
    await waitFor(() => expect(trackerClient.collectSshAgentSource).toHaveBeenCalledWith("known-worker", 30));

    fireEvent.click(within(savedHosts).getByRole("button", { name: "Remove saved SSH host known-worker" }));
    expect(screen.queryByLabelText("Saved SSH hosts")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]")).toEqual([]);
  });
});
