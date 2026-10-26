/** Synchronous main-window clearing before a tracker exclusion/deletion IPC starts. No
 * rule, app name or screen content is carried by this event. */
export const SCREEN_CONTEXT_POLICY_CHANGING = "drifty:screen-context-policy-changing";
export function screenContextPolicyChanging(): void {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    window.dispatchEvent(new Event(SCREEN_CONTEXT_POLICY_CHANGING));
  }
}
