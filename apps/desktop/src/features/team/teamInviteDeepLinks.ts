export const TEAM_INVITE_DEEP_LINK_EVENT = "drifty:team-invite";

const INVITE_CODE_PATTERN = /^DRFT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const COMPACT_INVITE_CODE_PATTERN = /^DRFT[A-Z0-9]{8}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const TEAM_INVITE_ORIGIN = "https://drifty.so";

export type PendingTeamInvite = {
  readonly inviteKey: string;
  readonly inviteCode: string | null;
};

export function parseTeamInviteDeepLink(value: string): PendingTeamInvite | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }

  if (url.protocol !== "drifty:" || url.hostname !== "team-invite") return null;
  const token = normalizeInviteToken(url.searchParams.get("token"));
  const inviteCode = normalizeInviteCode(url.searchParams.get("code"));
  if (!token && !inviteCode) return null;
  if (url.searchParams.has("token") && !token) return null;
  if (url.searchParams.has("code") && !inviteCode) return null;

  const inviteUrl = new URL("/team-invite", TEAM_INVITE_ORIGIN);
  if (token) inviteUrl.searchParams.set("token", token);
  if (inviteCode) inviteUrl.searchParams.set("code", inviteCode);

  return {
    inviteKey: inviteUrl.toString(),
    inviteCode,
  };
}

export function dispatchTeamInviteDeepLink(value: string): boolean {
  const pendingInvite = parseTeamInviteDeepLink(value);
  if (!pendingInvite) return false;
  window.dispatchEvent(new CustomEvent(TEAM_INVITE_DEEP_LINK_EVENT, { detail: pendingInvite }));
  return true;
}

export function readPendingTeamInviteFromEvent(event: Event): PendingTeamInvite | null {
  if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return null;
  const inviteKey = typeof event.detail.inviteKey === "string" ? event.detail.inviteKey : null;
  if (!inviteKey || !isSupportedInviteKey(inviteKey)) return null;
  const inviteCode = event.detail.inviteCode === null || event.detail.inviteCode === undefined
    ? null
    : normalizeInviteCode(event.detail.inviteCode);
  if (event.detail.inviteCode !== null && event.detail.inviteCode !== undefined && !inviteCode) return null;
  return { inviteKey, inviteCode };
}

function isSupportedInviteKey(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  if (url.origin !== TEAM_INVITE_ORIGIN || url.pathname !== "/team-invite") return false;
  const token = normalizeInviteToken(url.searchParams.get("token"));
  const inviteCode = normalizeInviteCode(url.searchParams.get("code"));
  if (!token && !inviteCode) return false;
  if (url.searchParams.has("token") && !token) return false;
  if (url.searchParams.has("code") && !inviteCode) return false;
  return true;
}

function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (INVITE_CODE_PATTERN.test(code)) return code;
  const compact = code.replace(/-/g, "");
  if (!COMPACT_INVITE_CODE_PATTERN.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
}

function normalizeInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return INVITE_TOKEN_PATTERN.test(token) ? token : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
