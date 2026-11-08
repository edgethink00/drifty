import { normalizeOpenAiCompatibleBaseUrl } from "../settings/localAiSetup";
import type { EndpointFailureDetail } from "./endpointFailure";

/**
 * Repairs the most common custom endpoint address mistakes: a server address
 * without its API path ("http://localhost:10100" instead of ".../v1") and a
 * full request URL pasted as the base URL (".../v1/chat/completions").
 *
 * A candidate is only ever the same origin, so a stored key is never sent to
 * another host. Callers switch to a candidate only after it has answered as
 * an OpenAI-compatible API, save the change visibly and offer to undo it;
 * an address the person restored is never repaired again.
 */
export type CustomEndpointAddressRepair = {
  readonly from: string;
  readonly to: string;
};

const NOTICE_STORAGE_KEY = "drifty.customEndpoint.addressRepair.v1";
const DECLINED_STORAGE_KEY = "drifty.customEndpoint.declinedAddressRepairs.v1";
const MAX_DECLINED = 20;
const REQUEST_SUFFIXES = ["/chat/completions", "/completions", "/models"] as const;

/** Same-origin addresses worth trying instead of `baseUrl`, most likely first. */
export function addressRepairCandidates(baseUrl: string): string[] {
  const normalized = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  if (!normalized) return [];
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return [];
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return [];
  const path = parsed.pathname.replace(/\/+$/, "");
  const candidates: string[] = [];
  const suffix = REQUEST_SUFFIXES.find((value) => path.toLowerCase().endsWith(value));
  if (suffix) {
    const trimmed = path.slice(0, -suffix.length);
    candidates.push(trimmed ? parsed.origin + trimmed : parsed.origin + "/v1");
  } else if (!path) {
    candidates.push(parsed.origin + "/v1");
  }
  return candidates.filter((candidate) => candidate !== normalized);
}

/** Answers that mean the address, not the server, is probably wrong. */
export function failureSuggestsWrongAddress(detail: EndpointFailureDetail | undefined): boolean {
  if (!detail) return false;
  if (detail.responseKind === "html" || detail.responseKind === "not_json") return true;
  return detail.responseKind === "http_error" && (detail.httpStatus === 404 || detail.httpStatus === 405);
}

export function isAddressRepairDeclined(baseUrl: string, storage: Storage | null = browserStorage()): boolean {
  const key = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  return key !== null && readDeclined(storage).includes(key);
}

export function recordDeclinedAddressRepair(baseUrl: string, storage: Storage | null = browserStorage()): void {
  const key = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  if (!key || !storage) return;
  const next = [key, ...readDeclined(storage).filter((value) => value !== key)].slice(0, MAX_DECLINED);
  try {
    storage.setItem(DECLINED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Without storage the repair may be offered again; nothing else depends on it.
  }
}

export function readAddressRepairNotice(storage: Storage | null = browserStorage()): CustomEndpointAddressRepair | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(NOTICE_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { from, to } = parsed as Record<string, unknown>;
    return typeof from === "string" && typeof to === "string" && from && to ? { from, to } : null;
  } catch {
    return null;
  }
}

export function writeAddressRepairNotice(notice: CustomEndpointAddressRepair | null, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (notice) storage.setItem(NOTICE_STORAGE_KEY, JSON.stringify(notice));
    else storage.removeItem(NOTICE_STORAGE_KEY);
  } catch {
    // The notice is a courtesy; the repaired address itself is already saved.
  }
}

/**
 * The first candidate that lists at least one model and, when `confirm` is
 * given, also passes it (a real connection test with the selected model).
 */
export async function findWorkingEndpointAddress(
  baseUrl: string,
  deps: {
    readonly listModels: (candidate: string) => Promise<{ readonly models: readonly string[] }>;
    readonly confirm?: (candidate: string) => Promise<boolean>;
    readonly isDeclined?: (baseUrl: string) => boolean;
  },
): Promise<string | null> {
  if ((deps.isDeclined ?? isAddressRepairDeclined)(baseUrl)) return null;
  for (const candidate of addressRepairCandidates(baseUrl)) {
    try {
      const listed = await deps.listModels(candidate);
      if (listed.models.length === 0) continue;
      if (deps.confirm && !(await deps.confirm(candidate))) continue;
      return candidate;
    } catch {
      // Try the next candidate; a failed probe never changes anything.
    }
  }
  return null;
}

function readDeclined(storage: Storage | null): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DECLINED_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
