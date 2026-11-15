import { invoke } from "@tauri-apps/api/core";

/** One download the start runs: the memory engine or the on-device search model. */
export type InstallProgress = {
  readonly phase: "missing" | "downloading" | "verifying" | "ready" | "failed" | "unsupported";
  readonly received: number;
  readonly total: number;
};

/**
 * What the Memory page's start downloads before it asks for anything: the
 * engine, then the search model it embeds with (owner decision 2026-11-15).
 * The app reads it natively; the browser preview passes a stand-in.
 */
export type MemoryInstaller = {
  readonly engine: () => Promise<InstallProgress | null>;
  readonly installEngine: () => Promise<void>;
  readonly models: () => Promise<InstallProgress | null>;
  readonly installModels: () => Promise<void>;
};

async function read(command: string): Promise<InstallProgress | null> {
  try { return await invoke<InstallProgress>(command); } catch { return null; }
}

export const nativeMemoryInstaller: MemoryInstaller = {
  engine: () => read("memory_runtime_status"),
  installEngine: () => invoke("memory_runtime_install"),
  models: () => read("memory_models_status"),
  installModels: () => invoke("memory_models_install"),
};

/**
 * Set when the start is pressed and cleared once memory is on. Granting screen
 * recording makes macOS quit and reopen Drifty; the reopened app finds this,
 * opens the Memory page and carries the start on, showing the same steps.
 */
export const MEMORY_START_PENDING_STORAGE_KEY = "drifty.memory.startPending.v1";
const PENDING_FOR_MS = 30 * 60_000;
/** When the start was pressed and which steps its list shows, so the reopened app shows the same list. */
export type PendingStart = { readonly at: number; readonly engine: boolean; readonly models: boolean; readonly key: boolean; readonly permission: boolean };

export function readPendingStart(now = Date.now()): PendingStart | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(MEMORY_START_PENDING_STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const { at, engine, models, key, permission } = raw as Record<string, unknown>;
    if (typeof at !== "number" || typeof engine !== "boolean" || typeof models !== "boolean" || typeof key !== "boolean" || typeof permission !== "boolean") return null;
    return now - at >= 0 && now - at < PENDING_FOR_MS ? { at, engine, models, key, permission } : null;
  } catch { return null; }
}

export function notePendingStart(value: Omit<PendingStart, "at"> | null, now = Date.now()): void {
  try {
    if (value) window.localStorage.setItem(MEMORY_START_PENDING_STORAGE_KEY, JSON.stringify({ at: now, ...value }));
    else window.localStorage.removeItem(MEMORY_START_PENDING_STORAGE_KEY);
  } catch {
    // Without storage a relaunch opens where it used to; pressing start again carries on.
  }
}

/**
 * Set when the person presses Allow for screen recording. macOS may let the
 * start finish before it quits and reopens the app, so the reopened app checks
 * this as well as the pending start to come back to the Memory page.
 */
export const MEMORY_REOPEN_STORAGE_KEY = "drifty.memory.reopenAfterGrant.v1";
const REOPEN_FOR_MS = 10 * 60_000;

export function noteReopenAfterGrant(now = Date.now()): void {
  try { window.localStorage.setItem(MEMORY_REOPEN_STORAGE_KEY, String(now)); } catch { /* the reopened app opens where it used to */ }
}

/** Whether a launch should open the Memory page to show or finish its start. */
export function memoryStartReopens(now = Date.now()): boolean {
  if (readPendingStart(now)) return true;
  try {
    const at = Number(window.localStorage.getItem(MEMORY_REOPEN_STORAGE_KEY));
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < REOPEN_FOR_MS;
  } catch { return false; }
}

export function clearReopenAfterGrant(): void {
  try { window.localStorage.removeItem(MEMORY_REOPEN_STORAGE_KEY); } catch { /* expires on its own */ }
}
