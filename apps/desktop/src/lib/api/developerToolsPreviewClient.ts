import type {
  DeveloperArtifactStatus,
  DeveloperSkillTarget,
  DeveloperToolsClient,
  DeveloperToolsStatus,
} from "./developerToolsClient";

/**
 * Browser preview stand-in for the native developer-tools commands. The Tauri
 * app never uses it: it only runs where shouldUsePreviewData() already swaps in
 * fixture data, so Settings › Agents & CLI can be reviewed in a plain browser.
 * Install and remove act on in-memory state with a short delay so the busy and
 * result states stay visible.
 */
export type DeveloperToolsPreviewScenario = "fresh" | "installed" | "attention";

export const DEVELOPER_TOOLS_PREVIEW_PARAM = "driftyAgentsPreview";

const SKILL_STATUS_KEYS = {
  codex: "codexSkill",
  claudeCode: "claudeCodeSkill",
  cursor: "cursorSkill",
  openCode: "openCodeSkill",
} as const satisfies Record<DeveloperSkillTarget, keyof DeveloperToolsStatus>;

const artifact = (
  state: DeveloperArtifactStatus["state"],
  installedPath: string,
  overrides: Partial<DeveloperArtifactStatus> = {},
): DeveloperArtifactStatus => ({
  state,
  installedPath,
  canInstall: state === "notInstalled",
  canRepair: state === "needsRepair",
  canUninstall: state === "installed",
  message: null,
  ...overrides,
});

function scenarioStatus(scenario: DeveloperToolsPreviewScenario): DeveloperToolsStatus {
  const fresh: DeveloperToolsStatus = {
    cli: artifact("notInstalled", "~/.local/bin/drifty"),
    codexSkill: artifact("notInstalled", "~/.codex/skills/drifty"),
    claudeCodeSkill: artifact("notInstalled", "~/.claude/skills/drifty"),
    cursorSkill: artifact("notInstalled", "~/.cursor/skills/drifty"),
    openCodeSkill: artifact("notInstalled", "~/.config/opencode/skills/drifty"),
  };
  if (scenario === "installed") {
    return {
      ...fresh,
      cli: artifact("installed", "~/.local/bin/drifty"),
      codexSkill: artifact("installed", "~/.codex/skills/drifty"),
      claudeCodeSkill: artifact("installed", "~/.claude/skills/drifty"),
    };
  }
  if (scenario === "attention") {
    return {
      ...fresh,
      cli: artifact("needsRepair", "~/.local/bin/drifty", {
        message: "The installed link points to an older or missing Drifty app. Repair it to use this app.",
      }),
      codexSkill: artifact("notInstalled", "~/.codex/skills/drifty", {
        canInstall: false,
        message: "This path points somewhere Drifty does not own. Drifty will not replace or remove it.",
      }),
      claudeCodeSkill: artifact("installed", "~/.claude/skills/drifty"),
    };
  }
  return fresh;
}

export function resolveDeveloperToolsPreviewScenario(search: string): DeveloperToolsPreviewScenario {
  const requested = new URLSearchParams(search).get(DEVELOPER_TOOLS_PREVIEW_PARAM);
  return requested === "installed" || requested === "attention" ? requested : "fresh";
}

export function createDeveloperToolsPreviewClient(
  scenario: DeveloperToolsPreviewScenario,
  delayMs = 700,
): DeveloperToolsClient {
  let status = scenarioStatus(scenario);
  const wait = () => new Promise<void>((resolve) => { globalThis.setTimeout(resolve, delayMs); });
  const settle = (key: keyof DeveloperToolsStatus, state: "installed" | "notInstalled") => {
    status = { ...status, [key]: artifact(state, status[key].installedPath) };
    return status[key];
  };

  return {
    isAvailable: () => true,
    async getStatus() {
      return status;
    },
    async installCli() {
      await wait();
      return settle("cli", "installed");
    },
    async uninstallCli() {
      await wait();
      return settle("cli", "notInstalled");
    },
    async installSkill(target) {
      await wait();
      return settle(SKILL_STATUS_KEYS[target], "installed");
    },
    async uninstallSkill(target) {
      await wait();
      return settle(SKILL_STATUS_KEYS[target], "notInstalled");
    },
  };
}
