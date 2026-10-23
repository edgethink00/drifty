import type { Session } from "@supabase/supabase-js";

export type DesktopAuthSession = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

export type DesktopSessionClearSkipReason =
  | "initial-null-session-during-auth-init"
  | "signed-out-during-auth-init"
  | "native-restore-failed";

export type SaveDesktopSessionOptions = {
  readonly allowClear?: boolean;
  readonly throwOnError?: boolean;
  readonly skipReason?: DesktopSessionClearSkipReason;
};

export function serializeDesktopAuthSession(session: Session): string {
  return JSON.stringify({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
}

export function parseDesktopAuthSession(value: string | null): DesktopAuthSession | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    if (!("accessToken" in parsed) || !("refreshToken" in parsed)) return null;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") return null;
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
