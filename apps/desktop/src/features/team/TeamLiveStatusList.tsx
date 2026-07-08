import { formatRoundedDuration } from "../../lib/formatting";
import type { TeamLiveStatusRow } from "./teamService";

export function TeamLiveStatusList({ rows }: { readonly rows: readonly TeamLiveStatusRow[] }) {
  return (
    <ol className="team-live-list" aria-label="Live now">
      {rows.map((row) => {
        const focusValue = row.focus_share_scope === "focus_only"
          ? `${formatRoundedDuration(row.focus_seconds)} · ${Math.round(row.focus_score)}%`
          : "Private";
        return (
          <li className="team-live-row" data-state={row.presence_state} key={`${row.organization_id}-${row.member_display_name}-${row.last_shared_at || row.presence_state}`}>
            <div className="team-live-row__topline">
              <TeamMemberAvatar avatarUrl={row.profile_avatar_url} displayName={row.member_display_name} />
              <div className="team-live-row__identity">
                <strong>{row.member_display_name}</strong>
                <span>{row.role_label || "Member"}</span>
              </div>
            </div>
            <span className="team-presence" data-state={row.presence_state}>{presenceLabel(row.presence_state)}</span>
            <div className="team-live-row__meta" aria-label={`${row.member_display_name} aggregate status`}>
              <span><em>Focus</em><b>{focusValue}</b></span>
              <span><em>Updated</em><b>{formatSharedAt(row.last_shared_at)}</b></span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TeamMemberAvatar({ avatarUrl, displayName }: { readonly avatarUrl: string; readonly displayName: string }) {
  const trimmedAvatarUrl = avatarUrl.trim();
  if (trimmedAvatarUrl.length > 0) {
    return <img className="team-live-avatar" src={trimmedAvatarUrl} alt="" aria-hidden="true" />;
  }

  return <span className="team-live-avatar" aria-hidden="true">{avatarInitials(displayName)}</span>;
}

function avatarInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter((word) => word.length > 0);
  const stems = words.length > 1 ? words.slice(0, 2) : words;
  const initials = stems
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
  return initials || "?";
}

function presenceLabel(state: TeamLiveStatusRow["presence_state"]) {
  if (state === "active_now") return "Active now";
  if (state === "recent") return "Recent";
  if (state === "shared") return "Shared";
  return "Private";
}

function formatSharedAt(value: string) {
  if (!value) return "No aggregate";
  const isoTime = value.match(/T(\d{2}:\d{2})/);
  if (isoTime) return isoTime[1];
  return value.slice(0, 16).replace("T", " ");
}
