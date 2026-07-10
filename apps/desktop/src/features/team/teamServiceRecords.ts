import {
  DEFAULT_TEAM_PERIOD,
  TEAM_PERIODS,
  type TeamInviteStatus,
  type TeamPeriod,
  type TeamPresenceState,
  type TeamProjectAnchor,
  type TeamProjectStatus,
  type TeamShareScope,
} from "./teamTypes";

export function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

export function readProjectStatus(record: Record<string, unknown>): TeamProjectStatus {
  return record.status === "archived" ? "archived" : "active";
}

export function readTeamProjectAnchors(value: unknown): readonly TeamProjectAnchor[] {
  if (!Array.isArray(value)) return [];
  const anchors: TeamProjectAnchor[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const kind = entry.kind;
    const anchorValue = entry.value;
    if ((kind === "app" || kind === "domain" || kind === "keyword") && typeof anchorValue === "string" && anchorValue.length > 0) {
      anchors.push({ kind, value: anchorValue });
    }
  }
  return anchors;
}

export function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  const numberValue = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  const numberValue = typeof value === "number" || typeof value === "string" ? Number(value) : null;
  return numberValue !== null && Number.isFinite(numberValue) ? numberValue : null;
}

export function readPeriod(record: Record<string, unknown>): TeamPeriod {
  const value = record.period;
  return isTeamPeriod(value) ? value : DEFAULT_TEAM_PERIOD;
}

export function readShareScope(record: Record<string, unknown>): TeamShareScope {
  return record.focus_share_scope === "focus_only" ? "focus_only" : "private";
}

export function readPresenceState(record: Record<string, unknown>): TeamPresenceState {
  const value = record.presence_state;
  if (value === "active_now" || value === "recent" || value === "shared") return value;
  return "private";
}

export function readInviteStatus(record: Record<string, unknown>): TeamInviteStatus {
  const value = record.status;
  return value === "accepted" || value === "revoked" || value === "expired" ? value : "pending";
}

export function isTeamPeriod(value: unknown): value is TeamPeriod {
  return typeof value === "string" && TEAM_PERIODS.some((period) => period === value);
}

export function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
