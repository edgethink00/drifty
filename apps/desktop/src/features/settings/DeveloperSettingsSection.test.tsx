// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeveloperArtifactStatus,
  DeveloperToolsClient,
  DeveloperToolsStatus,
} from "../../lib/api/developerToolsClient";
import { DeveloperSettingsSection } from "./DeveloperSettingsSection";

const artifact = (overrides: Partial<DeveloperArtifactStatus> = {}): DeveloperArtifactStatus => ({
  state: "notInstalled",
  installedPath: "~/.local/bin/drifty",
  canInstall: true,
  canRepair: false,
  canUninstall: false,
  message: null,
  ...overrides,
});

const status = (overrides: Partial<DeveloperToolsStatus> = {}): DeveloperToolsStatus => ({
  cli: artifact(),
  codexSkill: artifact({ installedPath: "~/.codex/skills/drifty" }),
  claudeCodeSkill: artifact({ installedPath: "~/.claude/skills/drifty" }),
  cursorSkill: artifact({ installedPath: "~/.cursor/skills/drifty" }),
  openCodeSkill: artifact({ installedPath: "~/.config/opencode/skills/drifty" }),
  ...overrides,
});

function mockClient(initialStatus: DeveloperToolsStatus): DeveloperToolsClient {
  return {
    isAvailable: () => true,
    getStatus: vi.fn().mockResolvedValue(initialStatus),
    installCli: vi.fn().mockResolvedValue(artifact({ state: "installed", canInstall: false, canUninstall: true })),
    uninstallCli: vi.fn().mockResolvedValue(artifact()),
    installSkill: vi.fn().mockResolvedValue(artifact({ state: "installed", canInstall: false, canUninstall: true })),
    uninstallSkill: vi.fn().mockResolvedValue(artifact()),
  };
}

describe("DeveloperSettingsSection", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(cleanup);

  it("shows command examples and install actions without shell setup before CLI installation", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    expect(await screen.findByRole("button", { name: /Install CLI: Command line tools/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add skill to…" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CLI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agent skill" })).toBeTruthy();
    expect(screen.getAllByText("drifty summary --day 2026-08-04").length).toBe(2);
    expect(screen.getByText("drifty search --query \"CLI\"")).toBeTruthy();
    expect(screen.getByText("~/.codex/skills/drifty")).toBeTruthy();
    expect(screen.queryByText('export PATH="$HOME/.local/bin:$PATH"')).toBeNull();
    expect(screen.getByText(/use --detail full for URLs and window titles/i)).toBeTruthy();
    expect(screen.getByText(/does not add network access/i)).toBeTruthy();
    expect(screen.queryByText(/Give local agents a safe, read-only way/i)).toBeNull();
    expect(screen.queryByText(/Query summaries, matching activity, and timelines/i)).toBeNull();
    expect(screen.queryByText(/Add Drifty's query guidance to the agent/i)).toBeNull();
    expect(screen.queryByText("LOCAL COMMAND LINE")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy command:/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ask Drifty about your recorded work" })).toBeNull();
  });

  it("shows and copies the shell-startup line once the CLI is installed", async () => {
    render(<DeveloperSettingsSection client={mockClient(status({
      cli: artifact({ state: "installed", canInstall: false, canUninstall: true }),
    }))} />);

    expect(await screen.findByText('export PATH="$HOME/.local/bin:$PATH"')).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: /Copy path: export PATH=/i });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export PATH="$HOME/.local/bin:$PATH"'));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("opens the agent picker and installs the Codex skill from its target row", async () => {
    const client = mockClient(status());
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add skill to…" }));

    expect(screen.getByRole("menu", { name: "All agents" })).toBeTruthy();
    expect(screen.getByText("~/.claude/skills")).toBeTruthy();
    expect(screen.queryByText("Coming soon")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: /Codex.*~\/.codex\/skills.*Add/i }));

    await waitFor(() => expect(client.installSkill).toHaveBeenCalledWith("codex"));
  });

  it("installs the selected Cursor skill and updates the skill location", async () => {
    const client = mockClient(status());
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add skill to…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Cursor.*~\/\.cursor\/skills.*Add/i }));

    await waitFor(() => expect(client.installSkill).toHaveBeenCalledWith("cursor"));
    expect(screen.getByRole("heading", { name: "Cursor agent skill" })).toBeTruthy();
    expect(screen.getByText("~/.cursor/skills/drifty")).toBeTruthy();
  });

  it("removes only the selected installed agent skill", async () => {
    const client = mockClient(status({
      cursorSkill: artifact({
        state: "installed",
        installedPath: "~/.cursor/skills/drifty",
        canInstall: false,
        canUninstall: true,
      }),
    }));
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add skill to…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Cursor.*Added/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove: Cursor" }));

    await waitFor(() => expect(client.uninstallSkill).toHaveBeenCalledWith("cursor"));
    expect(client.uninstallSkill).not.toHaveBeenCalledWith("codex");
  });

  it("installs through the native client and refreshes status", async () => {
    const installed = status({
      cli: artifact({ state: "installed", canInstall: false, canUninstall: true }),
    });
    const client = mockClient(status());
    vi.mocked(client.getStatus).mockResolvedValueOnce(status()).mockResolvedValueOnce(installed);
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: /Install CLI: Command line tools/i }));

    await waitFor(() => expect(client.installCli).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /Reinstall: Command line tools/i })).toBeTruthy();
    expect(screen.queryByText("Installed")).toBeNull();
    expect(screen.queryByRole("button", { name: /Uninstall: Command line tools/i })).toBeNull();
  });

  it("does not offer destructive actions for a foreign path", async () => {
    const client = mockClient(status({
      cli: artifact({
        state: "needsRepair",
        canInstall: false,
        canRepair: false,
        canUninstall: false,
        message: "This path points somewhere Drifty does not own. Drifty will not replace or remove it.",
      }),
    }));
    render(<DeveloperSettingsSection client={client} />);

    expect(await screen.findByText("Needs repair")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Repair: Command line tools/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Uninstall: Command line tools/i })).toBeNull();
    expect(screen.queryByText('export PATH="$HOME/.local/bin:$PATH"')).toBeNull();
    expect(screen.getByText(/will not replace or remove/i)).toBeTruthy();
  });

  it("labels unavailable browser builds without invoking native actions", async () => {
    const baseClient = mockClient(status());
    const client: DeveloperToolsClient = { ...baseClient, isAvailable: () => false };
    render(<DeveloperSettingsSection client={client} />);

    expect((await screen.findAllByText("Unavailable in this build")).length).toBe(1);
    expect(client.getStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Install CLI/i })).toBeNull();
  });
});
