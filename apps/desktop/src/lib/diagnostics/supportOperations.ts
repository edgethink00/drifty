import { diagnosticCode, projectFeedbackDiagnostics } from "@drifty/domain";
/** Local, bounded, content-free Chat attempts. IDs are generated here, never
 * conversation/account/segment IDs. Nothing is sent until feedback is sent. */
const KEY = "drifty.support.operations.v1";
const RETENTION_MS = 14 * 86_400_000;
export type SupportOperation = {
  id: string; provider: "cloud" | "codex" | "claude"; phase: string; result: string;
  errorCode: string | null; startedAt: string; finishedAt: string | null;
  durationMs: number | null; firstResponseMs: number | null; toolCalls: number; exitCode: number | null; httpStatus: number | null;
};
function storage(): Storage | null { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } }
export function readSupportOperations(now = Date.now()): SupportOperation[] {
  try {
    const raw: unknown = JSON.parse(storage()?.getItem(KEY) ?? "[]");
    const safe = projectFeedbackDiagnostics({ operations: raw })?.operations as SupportOperation[];
    return safe.filter(item => typeof item.id === "string" && Number.isFinite(Date.parse(item.startedAt))
      && Date.parse(item.startedAt) >= now - RETENTION_MS && Date.parse(item.startedAt) <= now + 60_000).slice(-40);
  } catch { return []; }
}
function save(entry: SupportOperation): void {
  try {
    const entries = readSupportOperations().filter(item => item.id !== entry.id);
    if (entries.length >= 40) {
      const ordinary = entries.findIndex(item => item.result === "done");
      entries.splice(ordinary < 0 ? 0 : ordinary, 1);
    }
    storage()?.setItem(KEY, JSON.stringify([...entries, entry]));
  }
  catch { /* A diagnostic cannot affect Chat, including storage exhaustion. */ }
}
export function beginSupportOperation(provider: SupportOperation["provider"]) {
  const started = Date.now();
  let id: string;
  try { id = crypto.randomUUID(); } catch { return { firstResponse() {}, finish() {} }; }
  const entry: SupportOperation = { id, provider, phase: "start", result: "running",
    errorCode: null, startedAt: new Date(started).toISOString(), finishedAt: null,
    durationMs: null, firstResponseMs: null, toolCalls: 0, exitCode: null, httpStatus: null };
  save(entry);
  return {
    firstResponse() {
      if (entry.firstResponseMs !== null) return;
      entry.firstResponseMs = Math.max(0, Date.now() - started); entry.phase = "first_response"; save(entry);
    },
    finish(result: "done" | "error" | "cancelled", errorCode: string | null, toolCalls: number, exitCode: number | null, httpStatus: number | null = null) {
      entry.phase = "finish"; entry.result = result; entry.errorCode = diagnosticCode(errorCode);
      entry.finishedAt = new Date().toISOString(); entry.durationMs = Math.max(0, Date.now() - started);
      entry.toolCalls = Math.max(0, Math.floor(toolCalls)); entry.exitCode = exitCode; entry.httpStatus = httpStatus; save(entry);
    },
  };
}

