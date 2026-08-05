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
  ...overrides,
});

function mockClient(initialStatus: DeveloperToolsStatus): DeveloperToolsClient {
  return {
    isAvailable: () => true,
    getStatus: vi.fn().mockResolvedValue(initialStatus),
    installCli: vi.fn().mockResolvedValue(artifact({ state: "installed", canInstall: false, canUninstall: true })),
    uninstallCli: vi.fn().mockResolvedValue(artifact()),
    installCodexSkill: vi.fn().mockResolvedValue(artifact({ state: "installed", canInstall: false, canUninstall: true })),
    uninstallCodexSkill: vi.fn().mockResolvedValue(artifact()),
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

  it("shows the CLI value, command examples, install actions, and PATH guidance", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    expect(await screen.findByRole("button", { name: /Install CLI: Command line tools/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add to Codex: Codex agent skill/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CLI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Agent skill" })).toBeTruthy();
    expect(screen.getAllByText("drifty summary --day 2026-08-04").length).toBe(2);
    expect(screen.getByText("drifty search --query \"CLI\"")).toBeTruthy();
    expect(screen.getByText("~/.local/bin/drifty")).toBeTruthy();
    expect(screen.getByText("~/.codex/skills/drifty")).toBeTruthy();
    expect(screen.getByText(/never edits shell startup files/i)).toBeTruthy();
    expect(screen.getByText(/Full URLs and window titles require/i)).toBeTruthy();
    expect(screen.getByText(/does not add network access/i)).toBeTruthy();
  });

  it("copies commands and exposes confirmation feedback", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    const copyButton = await screen.findByRole("button", { name: /Copy command: drifty summary --day 2026-08-04/i });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("drifty summary --day 2026-08-04"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
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
    expect(await screen.findByRole("button", { name: /Uninstall: Command line tools/i })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: /Copy path: ~\/.local\/bin\/drifty/i })).toBeTruthy();
    expect(screen.getByText(/will not replace or remove/i)).toBeTruthy();
  });

  it("labels unavailable browser builds without invoking native actions", async () => {
    const baseClient = mockClient(status());
    const client: DeveloperToolsClient = { ...baseClient, isAvailable: () => false };
    render(<DeveloperSettingsSection client={client} />);

    expect((await screen.findAllByText("Unavailable in this build")).length).toBe(2);
    expect(client.getStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Install CLI/i })).toBeNull();
  });
});
