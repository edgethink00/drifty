import type { ChatProvider } from "./chatTypes";

/** Reads only the signed-in answer from `claude auth status` (JSON) or `codex login status` (text). Mirrors the native parser. */
export function parseCliSignedIn(provider: ChatProvider, stdout: string, stderr: string): boolean | null {
  if (provider === "claude") {
    try {
      const value: unknown = JSON.parse(stdout.trim());
      return typeof value === "object" && value !== null && typeof (value as { loggedIn?: unknown }).loggedIn === "boolean"
        ? (value as { loggedIn: boolean }).loggedIn
        : null;
    } catch {
      return null;
    }
  }
  const text = stdout + "\n" + stderr;
  if (text.includes("Not logged in")) return false;
  if (text.includes("Logged in")) return true;
  return null;
}
