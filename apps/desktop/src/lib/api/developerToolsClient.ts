import { invoke } from "@tauri-apps/api/core";

const ARTIFACT_STATES = ["notInstalled", "installed", "needsRepair", "unavailableInBuild"] as const;

export const developerToolsInvokeCommands = {
  getStatus: "developer_tools_get_status",
  installCli: "developer_tools_install_cli",
  uninstallCli: "developer_tools_uninstall_cli",
  installSkill: "developer_tools_install_skill",
  uninstallSkill: "developer_tools_uninstall_skill",
} as const;

export type DeveloperArtifactState = (typeof ARTIFACT_STATES)[number];
export type DeveloperSkillTarget = "codex" | "claudeCode" | "cursor" | "openCode";

export type DeveloperArtifactStatus = {
  readonly state: DeveloperArtifactState;
  readonly installedPath: string;
  readonly canInstall: boolean;
  readonly canRepair: boolean;
  readonly canUninstall: boolean;
  readonly message: string | null;
};

export type DeveloperToolsStatus = {
  readonly cli: DeveloperArtifactStatus;
  readonly codexSkill: DeveloperArtifactStatus;
  readonly claudeCodeSkill: DeveloperArtifactStatus;
  readonly cursorSkill: DeveloperArtifactStatus;
  readonly openCodeSkill: DeveloperArtifactStatus;
};

export type DeveloperToolsClient = {
  readonly isAvailable: () => boolean;
  readonly getStatus: () => Promise<DeveloperToolsStatus>;
  readonly installCli: () => Promise<DeveloperArtifactStatus>;
  readonly uninstallCli: () => Promise<DeveloperArtifactStatus>;
  readonly installSkill: (target: DeveloperSkillTarget) => Promise<DeveloperArtifactStatus>;
  readonly uninstallSkill: (target: DeveloperSkillTarget) => Promise<DeveloperArtifactStatus>;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseArtifact(value: unknown): DeveloperArtifactStatus {
  if (!value || typeof value !== "object") throw new Error("Developer tools returned an invalid response.");
  const state = Reflect.get(value, "state");
  const installedPath = Reflect.get(value, "installedPath");
  const canInstall = Reflect.get(value, "canInstall");
  const canRepair = Reflect.get(value, "canRepair");
  const canUninstall = Reflect.get(value, "canUninstall");
  const message = Reflect.get(value, "message");
  if (
    !isArtifactState(state)
    || typeof installedPath !== "string"
    || typeof canInstall !== "boolean"
    || typeof canRepair !== "boolean"
    || typeof canUninstall !== "boolean"
    || (message !== null && typeof message !== "string")
  ) {
    throw new Error("Developer tools returned an invalid response.");
  }
  return { state, installedPath, canInstall, canRepair, canUninstall, message };
}

function isArtifactState(value: unknown): value is DeveloperArtifactState {
  return typeof value === "string" && ARTIFACT_STATES.some((candidate) => candidate === value);
}

function parseStatus(value: unknown): DeveloperToolsStatus {
  if (!value || typeof value !== "object") throw new Error("Developer tools returned an invalid response.");
  return {
    cli: parseArtifact(Reflect.get(value, "cli")),
    codexSkill: parseArtifact(Reflect.get(value, "codexSkill")),
    claudeCodeSkill: parseArtifact(Reflect.get(value, "claudeCodeSkill")),
    cursorSkill: parseArtifact(Reflect.get(value, "cursorSkill")),
    openCodeSkill: parseArtifact(Reflect.get(value, "openCodeSkill")),
  };
}

export const developerToolsClient: DeveloperToolsClient = {
  isAvailable: isTauriRuntime,
  async getStatus() {
    return parseStatus(await invoke<unknown>(developerToolsInvokeCommands.getStatus));
  },
  async installCli() {
    return parseArtifact(await invoke<unknown>(developerToolsInvokeCommands.installCli));
  },
  async uninstallCli() {
    return parseArtifact(await invoke<unknown>(developerToolsInvokeCommands.uninstallCli));
  },
  async installSkill(target) {
    return parseArtifact(await invoke<unknown>(developerToolsInvokeCommands.installSkill, { target }));
  },
  async uninstallSkill(target) {
    return parseArtifact(await invoke<unknown>(developerToolsInvokeCommands.uninstallSkill, { target }));
  },
};
