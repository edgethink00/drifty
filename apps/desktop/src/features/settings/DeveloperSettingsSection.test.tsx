// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeveloperArtifactStatus,
  DeveloperToolsClient,
  DeveloperToolsStatus,
} from "../../lib/api/developerToolsClient";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DeveloperSettingsSection } from "./DeveloperSettingsSection";
import { MemoryAgentsLine } from "./MemoryAgentsRow";

const artifact = (overrides: Partial<DeveloperArtifactStatus> = {}): DeveloperArtifactStatus => ({
  state: "notInstalled",
  installedPath: "~/.local/bin/drifty",
  canInstall: true,
  canRepair: false,
  canUninstall: false,
  message: null,
  ...overrides,
});

const installed = (installedPath: string) => artifact({ state: "installed", installedPath, canInstall: false, canUninstall: true });

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
    installCli: vi.fn().mockResolvedValue(installed("~/.local/bin/drifty")),
    uninstallCli: vi.fn().mockResolvedValue(artifact()),
    installSkill: vi.fn().mockResolvedValue(installed("~/.codex/skills/drifty")),
    uninstallSkill: vi.fn().mockResolvedValue(artifact()),
  };
}

const ADD_TRIGGER = { name: "Add to agent…" } as const;
const MENU = { name: "Choose an agent" } as const;

describe("DeveloperSettingsSection", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts with the CLI install and an agent picker, saying the skill needs the CLI", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    expect(await screen.findByRole("button", { name: "Install CLI: Drifty CLI" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Command line" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add Drifty to your agent" })).toBeTruthy();
    expect(screen.getByText("Agent skill")).toBeTruthy();
    expect(screen.getByRole("button", ADD_TRIGGER)).toBeTruthy();
    expect(screen.getByText("Not added to any agent yet.")).toBeTruthy();
    expect(screen.getByText("Install the CLI above first.")).toBeTruthy();
    // No standing note about Drifty's internals; memory states its own line when present.
    expect(screen.queryByText(/network access/i)).toBeNull();
    expect(document.querySelector('[data-setting-id="settings.developer.memoryAgents"]')).toBeNull();
    expect(screen.queryByText("Installed")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByText('export PATH="$HOME/.local/bin:$PATH"')).toBeNull();
    expect(screen.getByRole("button", { name: "Example commands" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("says inside the skill row whether added agents can read automatic memory", async () => {
    const openMemory = vi.fn();
    const { rerender } = render(
      <DeveloperSettingsSection client={mockClient(status())} memory={<MemoryAgentsLine on={false} onOpenMemory={openMemory} />} />,
    );
    expect(await screen.findByText(/Turn on automatic memory and agents you added can read it too/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open memory" }));
    expect(openMemory).toHaveBeenCalledTimes(1);
    rerender(<DeveloperSettingsSection client={mockClient(status())} memory={<MemoryAgentsLine on onOpenMemory={openMemory} />} />);
    expect(screen.getByText(/agents you added can also read your memory pages/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open memory" })).toBeNull();
  });

  it("expands example commands with today's date and copies one exactly", async () => {
    // Only Date is faked so the async status load still settles normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 15, 30));
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    const toggle = await screen.findByRole("button", { name: "Example commands" });
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("drifty summary --day 2026-10-04")).toBeTruthy();
    expect(screen.getByText("drifty search --query \"CLI\"")).toBeTruthy();
    expect(screen.getByText("drifty timeline --day 2026-10-04")).toBeTruthy();
    expect(screen.getByText("--detail full", { selector: "code" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy command: drifty timeline --day 2026-10-04" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("drifty timeline --day 2026-10-04"));
  });

  it("names every agent the skill is added to on the row and removes only the chosen one", async () => {
    const client = mockClient(status({
      cli: installed("~/.local/bin/drifty"),
      claudeCodeSkill: installed("~/.claude/skills/drifty"),
      cursorSkill: installed("~/.cursor/skills/drifty"),
    }));
    render(<DeveloperSettingsSection client={client} />);

    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(screen.getByText("~/.local/bin/drifty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove: Drifty CLI" })).toBeTruthy();
    // No visible "Added to" label: the chips stand alone, named for screen readers.
    expect(screen.queryByText("Added to")).toBeNull();
    expect(screen.getByRole("list", { name: "Added to" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from Claude Code" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from Codex" })).toBeNull();
    expect(screen.queryByText("Install the CLI above first.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove from Cursor" }));

    await waitFor(() => expect(client.uninstallSkill).toHaveBeenCalledWith("cursor"));
    expect(client.uninstallSkill).toHaveBeenCalledTimes(1);
  });

  it("adds a skill from the picker and marks agents that already have it", async () => {
    const client = mockClient(status({ codexSkill: installed("~/.codex/skills/drifty") }));
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", ADD_TRIGGER));
    const menu = screen.getByRole("menu", MENU);

    const codex = within(menu).getByRole("menuitem", { name: /Codex.*~\/\.codex\/skills.*Added/ }) as HTMLButtonElement;
    expect(codex.disabled).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Claude Code.*~\/\.claude\/skills.*Add/ }));

    await waitFor(() => expect(client.installSkill).toHaveBeenCalledWith("claudeCode"));
    expect(client.installSkill).toHaveBeenCalledTimes(1);
  });

  it("keeps the agent picker on screen through its exit and out of reach while it fades", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);
    fireEvent.click(await screen.findByRole("button", ADD_TRIGGER));

    const menu = screen.getByRole("menu", MENU);
    const boundary = menu.parentElement as HTMLElement;
    await waitFor(() => expect(boundary.getAttribute("data-anchored-presence")).toBe("open"));

    fireEvent.click(screen.getByRole("button", ADD_TRIGGER));

    expect(boundary.getAttribute("data-anchored-presence")).toBe("exiting");
    expect(boundary.inert).toBe(true);
    await waitFor(() => expect(screen.queryByRole("menu", MENU)).toBeNull());
  });

  it("closes the agent picker on Escape and returns focus to its trigger", async () => {
    render(<DeveloperSettingsSection client={mockClient(status())} />);

    const trigger = await screen.findByRole("button", ADD_TRIGGER);
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", MENU)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu", MENU)).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("moves through the agents it can act on with arrow keys and closes on Tab", async () => {
    render(<DeveloperSettingsSection client={mockClient(status({ cursorSkill: artifact({ installedPath: "~/.cursor/skills/drifty", canInstall: false }) }))} />);

    fireEvent.click(await screen.findByRole("button", ADD_TRIGGER));
    const menu = screen.getByRole("menu", MENU);
    const codex = within(menu).getByRole("menuitem", { name: /Codex/ });
    await waitFor(() => expect(document.activeElement).toBe(codex));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: /Claude Code/ }));
    // Cursor cannot be added here, so keyboard focus skips it.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: /OpenCode/ }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(codex);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: /OpenCode/ }));

    fireEvent.keyDown(menu, { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu", MENU)).toBeNull());
  });

  it("opens the agent picker upward when the page leaves too little room below the trigger", async () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("developer-skill-picker__trigger") ? rect(window.innerHeight - 80, 30) : rect(0, 0);
    });
    const heightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("developer-skill-picker__menu") ? 187 : 0;
    });
    try {
      render(<DeveloperSettingsSection client={mockClient(status())} />);
      fireEvent.click(await screen.findByRole("button", ADD_TRIGGER));
      expect(screen.getByRole("menu", MENU).className).toContain("developer-skill-picker__menu--above");
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it("offers shell setup as conditional help once the CLI is installed", async () => {
    render(<DeveloperSettingsSection client={mockClient(status({ cli: installed("~/.local/bin/drifty") }))} />);

    expect(await screen.findByText("If Terminal can’t find drifty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: 'Copy command: export PATH="$HOME/.local/bin:$PATH"' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export PATH="$HOME/.local/bin:$PATH"'));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("installs the CLI, locks other actions while busy, and then shows what to type", async () => {
    const client = mockClient(status());
    let finishInstall: (value: DeveloperArtifactStatus) => void = () => undefined;
    vi.mocked(client.installCli).mockReturnValueOnce(new Promise((resolve) => { finishInstall = resolve; }));
    vi.mocked(client.getStatus)
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ cli: installed("~/.local/bin/drifty") }));
    render(<DeveloperSettingsSection client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Install CLI: Drifty CLI" }));

    const busyButton = await screen.findByRole("button", { name: "Installing…: Drifty CLI" });
    expect(busyButton.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", ADD_TRIGGER) as HTMLButtonElement).disabled).toBe(true);

    finishInstall(installed("~/.local/bin/drifty"));

    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(client.installCli).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Example commands" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows problems on the row: Repair for a stale CLI link, and nothing destructive for a path Drifty does not own", async () => {
    const client = mockClient(status({
      cli: artifact({
        state: "needsRepair",
        canInstall: false,
        canRepair: true,
        message: "The installed link points to an older or missing Drifty app. Repair it to use this app.",
      }),
      codexSkill: artifact({
        installedPath: "~/.codex/skills/drifty",
        canInstall: false,
        message: "This path points somewhere Drifty does not own. Drifty will not replace or remove it.",
      }),
    }));
    render(<DeveloperSettingsSection client={client} />);

    expect(await screen.findByRole("button", { name: "Repair: Drifty CLI" })).toBeTruthy();
    expect(screen.getByText("Needs repair")).toBeTruthy();
    expect(screen.getByText("Repair the CLI above first.")).toBeTruthy();

    // The Codex problem is written on the row without opening the picker, and it is not listed as added.
    expect(screen.getByText(/^Codex: This path points somewhere Drifty does not own/).className).toContain("developer-note--warn");
    expect(screen.getByText("Not added to any agent yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove from Codex" })).toBeNull();

    fireEvent.click(screen.getByRole("button", ADD_TRIGGER));
    const codexItem = within(screen.getByRole("menu", MENU)).getByRole("menuitem", { name: /Codex.*Needs attention/ }) as HTMLButtonElement;
    expect(codexItem.disabled).toBe(true);
  });

  it("keeps a stale skill link among the added agents and repairs it from the picker", async () => {
    const client = mockClient(status({
      cli: installed("~/.local/bin/drifty"),
      cursorSkill: artifact({
        state: "needsRepair",
        installedPath: "~/.cursor/skills/drifty",
        canInstall: false,
        canRepair: true,
        message: "The installed link points to an older or missing Drifty app. Repair it to use this app.",
      }),
    }));
    render(<DeveloperSettingsSection client={client} />);

    const chip = (await screen.findByText("Cursor", { selector: ".developer-agent-chip__name" })).closest("li") as HTMLElement;
    expect(within(chip).getByText("Needs repair")).toBeTruthy();
    expect(within(chip).queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByRole("button", ADD_TRIGGER));
    fireEvent.click(within(screen.getByRole("menu", MENU)).getByRole("menuitem", { name: /Cursor.*Repair/ }));
    await waitFor(() => expect(client.installSkill).toHaveBeenCalledWith("cursor"));
  });

  it("labels unavailable browser builds without invoking native actions", async () => {
    const baseClient = mockClient(status());
    const client: DeveloperToolsClient = { ...baseClient, isAvailable: () => false };
    render(<DeveloperSettingsSection client={client} />);

    expect((await screen.findAllByText("Unavailable in this build")).length).toBe(2);
    expect(client.getStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Install CLI/i })).toBeNull();
    expect((screen.getByRole("button", ADD_TRIGGER) as HTMLButtonElement).disabled).toBe(true);
  });

  it("localizes native unavailable messages in Korean", async () => {
    const unavailableMessageStatus = status({
      cli: artifact({
        state: "unavailableInBuild",
        canInstall: false,
        message: "The CLI executable is unavailable in this build.",
      }),
      codexSkill: artifact({
        state: "unavailableInBuild",
        canInstall: false,
        installedPath: "~/.codex/skills/drifty",
        message: "The bundled Codex skill is unavailable in this build.",
      }),
    });

    render(
      <LocalizationTestProvider language="ko">
        <DeveloperSettingsSection client={mockClient(unavailableMessageStatus)} />
      </LocalizationTestProvider>,
    );

    expect(await screen.findByText("CLI 실행 파일이 이 빌드에 포함되어 있지 않습니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "에이전트에 추가…" })).toBeTruthy();
    expect(screen.queryByText("The CLI executable is unavailable in this build.")).toBeNull();
  });

  it("localizes a native repair warning in Korean", async () => {
    const repairStatus = status({
      cli: artifact({
        state: "needsRepair",
        canInstall: false,
        message: "This path points somewhere Drifty does not own. Drifty will not replace or remove it.",
      }),
    });

    render(
      <LocalizationTestProvider language="ko">
        <DeveloperSettingsSection client={mockClient(repairStatus)} />
      </LocalizationTestProvider>,
    );

    expect(await screen.findByText("이 경로가 Drifty 소유가 아닌 다른 위치를 가리킵니다. Drifty는 이를 바꾸거나 제거하지 않습니다.")).toBeTruthy();
    expect(screen.queryByText(/This path points somewhere/u)).toBeNull();
  });
});
