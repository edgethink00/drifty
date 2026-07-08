import type { FormEvent } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import type { RevokeTeamInviteInput, TeamFocusSummaryRow, TeamInvite } from "./teamService";

export function TeamRows({ rows }: { readonly rows: readonly TeamFocusSummaryRow[] }) {
  return (
    <ol className="team-row-list" aria-label="Aggregate member focus">
      {rows.map((row) => <li className="team-row" key={`${row.organization_id}-${row.member_display_name}-${row.updated_at}`}><span>{row.private_rank === null ? "—" : `#${row.private_rank}`}</span><strong>{row.member_display_name}</strong><em>{row.role_label || "Member"}</em><b>{formatRoundedDuration(row.focus_seconds)}</b><small>{Math.round(row.focus_score)}% · {formatWindow(row.window_start_date, row.window_end_date)}</small></li>)}
    </ol>
  );
}

export function InviteList({ invites, isActionLoading, onCopyInvite, onRevokeInvite }: { readonly invites: readonly TeamInvite[]; readonly isActionLoading: boolean; readonly onCopyInvite?: (value: string) => void | Promise<void>; readonly onRevokeInvite?: (input: RevokeTeamInviteInput) => void | Promise<void> }) {
  return (
    <ol className="team-invite-list" aria-label="Team invites">
      {invites.map((invite) => {
        const isPending = invite.status === "pending";
        return <li className="team-invite-row" key={invite.invite_id}><div><strong>{invite.invite_code}</strong><span>{invite.role_label} · {invite.status} · expires {formatDate(invite.expires_at)}</span></div><div className="team-row-actions"><button type="button" className="settings-btn" onClick={() => onCopyInvite?.(invite.invite_code)} disabled={!onCopyInvite}>Copy code</button><button type="button" className="settings-btn" onClick={() => onCopyInvite?.(invite.invite_url)} disabled={!onCopyInvite}>Copy link</button><button type="button" className="ghost-button" onClick={() => onRevokeInvite?.({ invite_id: invite.invite_id })} disabled={isActionLoading || !isPending || !onRevokeInvite}>Revoke</button></div></li>;
      })}
    </ol>
  );
}

export function TeamInviteControls({
  canCreateInvite,
  inviteRole,
  invites,
  isActionLoading,
  isInviteOpen,
  onCopyInvite,
  onInviteRoleChange,
  onRevokeInvite,
  onSubmitInvite,
}: {
  readonly canCreateInvite: boolean;
  readonly inviteRole: string;
  readonly invites: readonly TeamInvite[];
  readonly isActionLoading: boolean;
  readonly isInviteOpen: boolean;
  readonly onCopyInvite?: (value: string) => void | Promise<void>;
  readonly onInviteRoleChange: (value: string) => void;
  readonly onRevokeInvite?: (input: RevokeTeamInviteInput) => void | Promise<void>;
  readonly onSubmitInvite: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!isInviteOpen) return null;

  return (
    <div className="team-invite-dock" aria-label="Team invite controls">
      <form className="team-invite-form team-invite-form--inline" onSubmit={onSubmitInvite} aria-label="Create invite">
        <label><span>Role</span><input aria-label="Invite role" value={inviteRole} onChange={(event) => onInviteRoleChange(event.target.value)} placeholder="Member" /></label>
        <button type="submit" className="settings-btn" disabled={isActionLoading || !canCreateInvite}>{isActionLoading ? "Creating..." : "Create invite"}</button>
      </form>
      {invites.length === 0 ? <div className="team-small-empty team-small-empty--inline">No pending invites.</div> : <InviteList invites={invites} isActionLoading={isActionLoading} onCopyInvite={onCopyInvite} onRevokeInvite={onRevokeInvite} />}
    </div>
  );
}

export function TeamStateBlock({ eyebrow, title, detail, actionLabel, onAction }: { readonly eyebrow: string; readonly title: string; readonly detail: string; readonly actionLabel?: string; readonly onAction?: () => void }) {
  return <div className="empty-state team-state"><span className="eyebrow">{eyebrow}</span><strong>{title}</strong><p>{detail}</p>{actionLabel ? <button type="button" className="settings-btn" onClick={onAction} disabled={!onAction}>{actionLabel}</button> : null}</div>;
}

function formatWindow(startDay: string, endDay: string) {
  return `${startDay} to ${endDay}`;
}

function formatDate(value: string) {
  return value.slice(0, 10);
}
