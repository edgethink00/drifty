import type { PreReleaseUpdateStatus } from "./useDeveloperPreReleaseUpdateController";

export type AppStatusNoticeModel = {
  readonly detail: string;
  readonly role: "status" | "alert";
  readonly title: string;
};

export function buildManualUpdateStatusNotice(
  checking: boolean,
  message: string | null,
  error: string | null,
): AppStatusNoticeModel | null {
  if (error) {
    return {
      detail: error,
      role: "alert",
      title: "Update check failed",
    };
  }

  if (checking) {
    return {
      detail: message ?? "Checking signed update metadata.",
      role: "status",
      title: "Checking for updates",
    };
  }

  if (message) {
    return {
      detail: message,
      role: "status",
      title: "Update check complete",
    };
  }

  return null;
}

export function buildLatestBuildStatusNotice(
  status: PreReleaseUpdateStatus,
  message: string | null,
  error: string | null,
): AppStatusNoticeModel | null {
  if (error) {
    return {
      detail: error,
      role: "alert",
      title: "Latest build check failed",
    };
  }

  if (message) {
    return {
      detail: message,
      role: "status",
      title: "Latest build check",
    };
  }

  switch (status) {
    case "idle":
      return null;
    case "checking":
      return {
        detail: "Checking developer pre-release metadata.",
        role: "status",
        title: "Checking latest build",
      };
    case "available":
      return {
        detail: "A pre-release update is available.",
        role: "status",
        title: "Latest build available",
      };
    case "none":
      return {
        detail: "No pre-release update is available.",
        role: "status",
        title: "Latest build check complete",
      };
    case "installing":
      return {
        detail: "Installing pre-release update.",
        role: "status",
        title: "Installing latest build",
      };
    case "installed":
      return {
        detail: "Pre-release update installed. Relaunching...",
        role: "status",
        title: "Latest build installed",
      };
    case "unavailable":
      return {
        detail: "Pre-release updates are available only inside the desktop runtime.",
        role: "status",
        title: "Latest build unavailable",
      };
    case "error":
      return null;
    default:
      return assertNever(status);
  }
}

export function AppStatusNotice({ notice }: { readonly notice: AppStatusNoticeModel }) {
  return (
    <section
      className={notice.role === "alert" ? "notice notice--error app-status-notice" : "notice app-status-notice"}
      role={notice.role}
      aria-label={notice.title}
    >
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected pre-release update status: ${String(value)}`);
}
