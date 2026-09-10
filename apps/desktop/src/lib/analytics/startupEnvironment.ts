import type {
  StartupInstallLocation,
  StartupOpenAtLoginResult,
  StartupOpenAtLoginStatus,
} from "../api/startupSettingsClient";
import { startupSettingsClient } from "../api/startupSettingsClient";
import type {
  INSTALL_LOCATIONS,
  OPEN_AT_LOGIN_STATUSES,
  STARTUP_BACKENDS,
  STARTUP_REGISTRATION_PHASES,
} from "./eventTaxonomy";
import { capturePostHogEvent } from "./posthogClient";

type AnalyticsInstallLocation = (typeof INSTALL_LOCATIONS)[number];
type AnalyticsOpenAtLoginStatus = (typeof OPEN_AT_LOGIN_STATUSES)[number];
type AnalyticsStartupBackend = (typeof STARTUP_BACKENDS)[number];
type StartupRegistrationPhase = (typeof STARTUP_REGISTRATION_PHASES)[number];

const INSTALL_LOCATION_BY_CLIENT_VALUE: Readonly<Record<StartupInstallLocation, AnalyticsInstallLocation>> = {
  applications: "applications",
  userApplications: "user_applications",
  translocated: "translocated",
  removableVolume: "removable_volume",
  other: "other",
  unknown: "unknown",
};

const OPEN_AT_LOGIN_STATUS_BY_CLIENT_VALUE: Readonly<Record<StartupOpenAtLoginStatus, AnalyticsOpenAtLoginStatus>> = {
  enabled: "enabled",
  notRegistered: "not_registered",
  requiresApproval: "requires_approval",
  notFound: "not_found",
  unsupported: "unsupported",
};

const STARTUP_BACKEND_BY_CLIENT_VALUE: Readonly<Record<string, AnalyticsStartupBackend>> = {
  smAppService: "sm_app_service",
  registryRunKey: "registry_run_key",
  unsupported: "unsupported",
};

export function toAnalyticsInstallLocation(value: StartupInstallLocation | null): AnalyticsInstallLocation {
  if (!value) return "unknown";
  return INSTALL_LOCATION_BY_CLIENT_VALUE[value] ?? "unknown";
}

export function toAnalyticsOpenAtLoginStatus(value: StartupOpenAtLoginStatus | null): AnalyticsOpenAtLoginStatus {
  if (!value) return "unknown";
  return OPEN_AT_LOGIN_STATUS_BY_CLIENT_VALUE[value] ?? "unknown";
}

export function toAnalyticsStartupBackend(value: string | null): AnalyticsStartupBackend {
  if (!value) return "unknown";
  return STARTUP_BACKEND_BY_CLIENT_VALUE[value] ?? "unknown";
}

/**
 * Records where this launch is running from and whether the app is actually
 * registered to reopen at login. A translocated or removable-volume bundle
 * cannot survive a restart even when registration reports success, so the two
 * facts are only meaningful together.
 */
export async function reportStartupEnvironment(): Promise<void> {
  if (!startupSettingsClient.isAvailable()) return;
  const [location, startup] = await Promise.all([
    startupSettingsClient.getInstallLocation().catch(() => null),
    startupSettingsClient.getOpenAtLoginStatus().catch(() => null),
  ]);
  capturePostHogEvent("app_launch_environment", {
    install_location: toAnalyticsInstallLocation(location),
    open_at_login_status: toAnalyticsOpenAtLoginStatus(startup?.status ?? null),
    startup_backend: toAnalyticsStartupBackend(startup?.backend ?? null),
  });
}

/**
 * Records the outcome of an open-at-login write. The native call can report a
 * pending approval state instead of an error, which previously reached only the
 * developer console and left the day-two population unexplained.
 */
export function reportStartupRegistration(input: {
  readonly phase: StartupRegistrationPhase;
  readonly requestedEnabled: boolean;
  readonly outcome: StartupOpenAtLoginResult | null;
  readonly failed?: boolean;
}): void {
  const { phase, requestedEnabled, outcome, failed = false } = input;
  capturePostHogEvent("startup_registration", {
    phase,
    requested_enabled: requestedEnabled,
    result: failed ? "error" : outcome?.success ? "success" : "unavailable",
    open_at_login_status: toAnalyticsOpenAtLoginStatus(outcome?.status ?? null),
    startup_backend: toAnalyticsStartupBackend(outcome?.backend ?? null),
  });
}
