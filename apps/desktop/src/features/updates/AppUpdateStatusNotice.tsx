import { createPortal } from "react-dom";
import type { PreReleaseUpdateStatus } from "./useDeveloperPreReleaseUpdateController";

export const MANUAL_UPDATE_CHECK_FAILED_PREFIX = "Update check failed: ";

export type AppStatusNoticeModel = {
  readonly compact?: boolean;
  readonly detail: string;
  readonly role: "status" | "alert";
  readonly title: string;
};

export function buildManualUpdateStatusNotice({
  checking,
  error,
  hasAvailableUpdate,
  message,
}: {
  readonly checking: boolean;
  readonly error: string | null;
  readonly hasAvailableUpdate: boolean;
  readonly message: string | null;
}): AppStatusNoticeModel | null {
  if (error) {
    return {
      detail: error.startsWith(MANUAL_UPDATE_CHECK_FAILED_PREFIX)
        ? error.slice(MANUAL_UPDATE_CHECK_FAILED_PREFIX.length)
        : error,
      role: "alert",
      title: "Update check failed",
    };
  }

  if (checking || hasAvailableUpdate || !message) return null;

  return {
    compact: true,
    detail: message,
    role: "status",
    title: "Update check complete",
  };
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
  const showTitle = !notice.compact;
  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      className={notice.role === "alert" ? "app-status-notice app-status-notice--error" : "app-status-notice"}
      role={notice.role}
      aria-label={showTitle ? notice.title : notice.detail}
    >
      {showTitle ? <strong>{notice.title}</strong> : null}
      <span>{notice.detail}</span>
    </section>,
    document.body,
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected pre-release update status: ${String(value)}`);
}
