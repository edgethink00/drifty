import { invoke } from "@tauri-apps/api/core";

const STARTUP_OPEN_AT_LOGIN_STATUSES = [
  "enabled",
  "notRegistered",
  "requiresApproval",
  "notFound",
  "unsupported",
] as const;

export type StartupOpenAtLoginStatus = (typeof STARTUP_OPEN_AT_LOGIN_STATUSES)[number];

const STARTUP_INSTALL_LOCATIONS = [
  "applications",
  "userApplications",
  "translocated",
  "removableVolume",
  "other",
  "unknown",
] as const;

export type StartupInstallLocation = (typeof STARTUP_INSTALL_LOCATIONS)[number];

export type StartupOpenAtLoginResult = {
  readonly success: boolean;
  readonly enabled: boolean;
  readonly status: StartupOpenAtLoginStatus;
  readonly backend: string;
};

const unavailableStartupResult: StartupOpenAtLoginResult = {
  success: false,
  enabled: false,
  status: "unsupported",
  backend: "unsupported",
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isStartupOpenAtLoginStatus(value: unknown): value is StartupOpenAtLoginStatus {
  return typeof value === "string" && STARTUP_OPEN_AT_LOGIN_STATUSES.some((status) => status === value);
}

function isStartupInstallLocation(value: unknown): value is StartupInstallLocation {
  return typeof value === "string" && STARTUP_INSTALL_LOCATIONS.some((location) => location === value);
}

/** Reporting an unreadable location as unknown keeps launch analytics non-blocking. */
function parseStartupInstallLocation(value: unknown): StartupInstallLocation {
  if (!value || typeof value !== "object") return "unknown";
  const location: unknown = Reflect.get(value, "location");
  return isStartupInstallLocation(location) ? location : "unknown";
}

function parseStartupOpenAtLoginResult(value: unknown): StartupOpenAtLoginResult {
  if (!value || typeof value !== "object") {
    throw new Error("Startup settings returned an invalid response.");
  }

  const success: unknown = Reflect.get(value, "success");
  const enabled: unknown = Reflect.get(value, "enabled");
  const status: unknown = Reflect.get(value, "status");
  const backend: unknown = Reflect.get(value, "backend");

  if (
    typeof success !== "boolean"
    || typeof enabled !== "boolean"
    || !isStartupOpenAtLoginStatus(status)
    || typeof backend !== "string"
  ) {
    throw new Error("Startup settings returned an invalid response.");
  }

  return {
    success,
    enabled,
    status,
    backend,
  };
}

export const startupSettingsClient = {
  isAvailable() {
    return isTauriRuntime();
  },
  async isOpenAtLoginEnabled() {
    if (!isTauriRuntime()) return false;
    const result = parseStartupOpenAtLoginResult(await invoke<unknown>("startup_get_open_at_login_status"));
    return result.enabled;
  },
  async getOpenAtLoginStatus(): Promise<StartupOpenAtLoginResult> {
    if (!isTauriRuntime()) return unavailableStartupResult;
    return parseStartupOpenAtLoginResult(await invoke<unknown>("startup_get_open_at_login_status"));
  },
  async getInstallLocation(): Promise<StartupInstallLocation> {
    if (!isTauriRuntime()) return "unknown";
    return parseStartupInstallLocation(await invoke<unknown>("startup_get_install_location"));
  },
  async setOpenAtLoginEnabled(enabled: boolean) {
    if (!isTauriRuntime()) return unavailableStartupResult;
    return parseStartupOpenAtLoginResult(await invoke<unknown>("startup_set_open_at_login_enabled", { enabled }));
  },
};
