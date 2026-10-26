// Content-free lifecycle notifications. Never put tokens or user IDs in events.
export const DESKTOP_AUTH_SESSION_CHANGING = "drifty:desktop-auth-session-changing";
export const DESKTOP_AUTH_SESSION_CHANGED = "drifty:desktop-auth-session-changed";
export const DESKTOP_AUTH_SESSION_FAILED = "drifty:desktop-auth-session-failed";

export function notifyDesktopAuthSession(event: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}
