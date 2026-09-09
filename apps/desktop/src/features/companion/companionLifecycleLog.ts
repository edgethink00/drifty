import { recordDriftAlarmDebugEvent } from "./driftAlarmDebugLog";

/** A bounded local diagnostic, with no activity labels or raw alarm keys. */
export function recordCompanionLifecycle(reason: string, key?: string | null) {
  let hash = 2166136261;
  for (const char of key ?? "") hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  recordDriftAlarmDebugEvent({
    kind: "companion_lifecycle",
    alertKey: key ? `moment-${(hash >>> 0).toString(16)}` : null,
    reason,
  });
}
