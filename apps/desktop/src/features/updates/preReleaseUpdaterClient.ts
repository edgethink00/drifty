import { invoke, isTauri } from "@tauri-apps/api/core";
import { clearPostUpdateRelaunchFocusPending, markPostUpdateRelaunchFocusPending } from "./updatePolicy";

export type DeveloperPreReleaseUpdate = {
  readonly available: boolean;
  readonly currentVersion: string;
  readonly version: string | null;
  readonly date: string | null;
  readonly body: string | null;
};

export function isDeveloperPreReleaseUpdaterAvailable(): boolean {
  return typeof window !== "undefined" && (isTauri() || "__TAURI_INTERNALS__" in window);
}

export async function checkDeveloperPreReleaseUpdate(): Promise<DeveloperPreReleaseUpdate | null> {
  if (!isDeveloperPreReleaseUpdaterAvailable()) return null;
  return parseDeveloperPreReleaseUpdate(await invoke<unknown>("developer_check_pre_release_update"));
}

export async function installDeveloperPreReleaseUpdate(): Promise<boolean> {
  if (!isDeveloperPreReleaseUpdaterAvailable()) return false;
  return await invoke<boolean>("developer_install_pre_release_update");
}

export async function installAndRelaunchDeveloperPreReleaseUpdate(): Promise<boolean> {
  const didInstall = await installDeveloperPreReleaseUpdate();
  if (!didInstall) return false;

  markPostUpdateRelaunchFocusPending();
  try {
    await invoke<void>("app_restart_after_update");
    return true;
  } catch (error) {
    clearPostUpdateRelaunchFocusPending();
    throw error;
  }
}

function parseDeveloperPreReleaseUpdate(value: unknown): DeveloperPreReleaseUpdate {
  if (!isRecord(value)) {
    return unavailablePreReleaseUpdate("unknown");
  }

  const currentVersion = stringValue(value.currentVersion) || "unknown";
  const version = nullableString(value.version);
  const available = value.available === true && version !== null;

  return {
    available,
    currentVersion,
    version,
    date: nullableString(value.date),
    body: nullableString(value.body),
  };
}

function unavailablePreReleaseUpdate(currentVersion: string): DeveloperPreReleaseUpdate {
  return {
    available: false,
    currentVersion,
    version: null,
    date: null,
    body: null,
  };
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
