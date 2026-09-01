export const SSH_AGENT_SOURCES_STORAGE_KEY = "drifty.agents.sshSources.v1";

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

export function loadSshAgentSources(storage: Pick<Storage, "getItem"> = window.localStorage): SavedSshAgentSource[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SSH_AGENT_SOURCES_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedSource).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveSshAgentSources(
  sources: readonly SavedSshAgentSource[],
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(SSH_AGENT_SOURCES_STORAGE_KEY, JSON.stringify(sources.slice(0, 20)));
  } catch {
    // Collection remains usable when localStorage is blocked; only the saved
    // shortcut is unavailable.
  }
}

export function upsertSshAgentSource(
  sources: readonly SavedSshAgentSource[],
  source: SavedSshAgentSource,
): SavedSshAgentSource[] {
  return [source, ...sources.filter((candidate) => candidate.host !== source.host)].slice(0, 20);
}

export function removeSshAgentSource(
  sources: readonly SavedSshAgentSource[],
  host: string,
): SavedSshAgentSource[] {
  return sources.filter((source) => source.host !== host);
}
