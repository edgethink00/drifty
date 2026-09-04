export const SSH_AGENT_SOURCES_STORAGE_KEY = "drifty.agents.sshSources.v1";
export const SSH_AGENT_SOURCES_CHANGED_EVENT = "drifty:ssh-agent-sources-changed";
export const MAX_SAVED_SSH_AGENT_SOURCES = 20;

export interface SavedSshAgentSource {
  readonly host: string;
  readonly lastCollectedAt: string;
  readonly lastMessage: string;
  readonly turnsFound: number;
}

function isSavedSource(value: unknown): value is SavedSshAgentSource {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedSshAgentSource>;
  return typeof candidate.host === "string"
    && candidate.host.length > 0
    && typeof candidate.lastCollectedAt === "string"
    && typeof candidate.lastMessage === "string"
    && typeof candidate.turnsFound === "number"
    && Number.isFinite(candidate.turnsFound);
}

export function loadSshAgentSources(storage?: Pick<Storage, "getItem">): SavedSshAgentSource[] {
  try {
    const targetStorage = storage ?? window.localStorage;
    const parsed: unknown = JSON.parse(targetStorage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedSource).slice(0, MAX_SAVED_SSH_AGENT_SOURCES) : [];
  } catch {
    return [];
  }
}

export function saveSshAgentSources(
  sources: readonly SavedSshAgentSource[],
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    const targetStorage = storage ?? window.localStorage;
    targetStorage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources.slice(0, MAX_SAVED_SSH_AGENT_SOURCES)));
    if (typeof window !== "undefined" && storage === undefined) {
      window.dispatchEvent(new Event(SSH_AGENT_SOURCES_CHANGED_EVENT));
    }
    return true;
  } catch {
    // Collection remains usable when localStorage is blocked; only the saved
    // shortcut is unavailable.
    return false;
  }
}

export function subscribeSshAgentSources(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SSH_AGENT_SOURCES_STORAGE_KEY) listener();
  };
  window.addEventListener(SSH_AGENT_SOURCES_CHANGED_EVENT, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(SSH_AGENT_SOURCES_CHANGED_EVENT, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function upsertSshAgentSource(
  sources: readonly SavedSshAgentSource[],
  source: SavedSshAgentSource,
): SavedSshAgentSource[] {
  const existingIndex = sources.findIndex((candidate) => candidate.host === source.host);
  if (existingIndex < 0) {
    return sources.length >= MAX_SAVED_SSH_AGENT_SOURCES ? [...sources] : [source, ...sources];
  }
  return sources.map((candidate, index) => index === existingIndex ? source : candidate);
}

export function removeSshAgentSource(
  sources: readonly SavedSshAgentSource[],
  host: string,
): SavedSshAgentSource[] {
  return sources.filter((source) => source.host !== host);
}
