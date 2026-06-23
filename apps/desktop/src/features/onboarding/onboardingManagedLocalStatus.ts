import type { useManagedLocalAiSetup } from "../settings/useManagedLocalAiSetup";

type ManagedLocalStatus = ReturnType<typeof useManagedLocalAiSetup>["status"];

export function isManagedLocalReady(status: ManagedLocalStatus): status is NonNullable<ManagedLocalStatus> & {
  readonly selectedModelId: string;
  readonly baseUrl: string;
  readonly model: string;
} {
  if (!status?.selectedModelId || !status.baseUrl || !status.model) return false;
  switch (status.state) {
    case "installed":
    case "starting":
    case "running":
      return true;
    case "installing":
    case "error":
    case "not_installed":
      return false;
    default:
      return assertNeverManagedStatus(status.state);
  }
}

export function hasManagedLocalInstallStarted(status: ManagedLocalStatus): boolean {
  if (!status?.selectedModelId) return false;
  switch (status.state) {
    case "installed":
    case "starting":
    case "running":
    case "installing":
      return true;
    case "error":
    case "not_installed":
      return false;
    default:
      return assertNeverManagedStatus(status.state);
  }
}

class ManagedLocalStatusError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI status: ${state}`);
    this.name = "ManagedLocalStatusError";
  }
}

function assertNeverManagedStatus(value: never): never {
  throw new ManagedLocalStatusError(String(value));
}
