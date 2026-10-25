import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { KeyHint } from "../../components/KeyHint";
import { ModalPresence } from "../../components/ModalPresence";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { SettingsSelect } from "../settings/SettingsSelect";
import { isManagerDraftComplete, type TeamManagerAccess, type TeamManagerAssignment, type TeamManagerDraft, type TeamManagerSharing } from "./teamSharingPolicy";
import type { TeamDirectoryMember, TeamGroup, TeamInvite, TeamMember } from "./teamTypes";

const VISIBLE_TEAM_NAMES = 3;

type Translate = ReturnType<typeof useLocalization>["t"];

/** "Platform, Finance +2" for a manager's teams; nothing when the team has no groups to name. */
export function managerTeamsLabel(assignment: TeamManagerAssignment, groups: readonly TeamGroup[], t: Translate): string | null {
  if (groups.length === 0) return null;
  if (assignment.group_ids.length === 0) return t("team.managers.wholeTeam");
  const names = assignment.group_ids.map((id) => groups.find((group) => group.id === id)?.name).filter((name): name is string => Boolean(name));
  const shown = names.slice(0, VISIBLE_TEAM_NAMES).join(", ");
  const nested = assignment.group_ids.some((id) => groups.some((group) => group.parent_group_id === id));
  return (names.length > VISIBLE_TEAM_NAMES ? shown + " " + t("team.managers.more", { count: names.length - VISIBLE_TEAM_NAMES }) : shown) + (nested ? " · " + t("team.managers.includesTeams") : "");
}

const ACCESS_OPTIONS: readonly { readonly id: TeamManagerAccess; readonly title: TranslationKey; readonly body: TranslationKey }[] = [
  { id: "summary", title: "team.managers.access.summary", body: "team.managers.access.summaryHint" },
  { id: "detail", title: "team.managers.access.detail", body: "team.managers.access.detailHint" },
];

const SHARING_OPTIONS: readonly { readonly id: TeamManagerSharing; readonly title: TranslationKey; readonly body: TranslationKey }[] = [
  { id: "view", title: "team.managers.sharing.view", body: "team.managers.sharing.viewHint" },
  { id: "narrow", title: "team.managers.sharing.narrow", body: "team.managers.sharing.narrowHint" },
];

export type TeamRosterProps = {
  readonly members: readonly TeamMember[];
  /** The directory carries each person's group, for the second line and for search. */
  readonly people: readonly TeamDirectoryMember[];
  readonly groups: readonly TeamGroup[];
  readonly managers: readonly TeamManagerAssignment[];
  readonly onManagersChange: (next: readonly TeamManagerAssignment[]) => void;
  readonly canRemove: boolean;
  /** Asks to remove someone; the caller confirms in a dialog that says what removing ends. */
  readonly onRemove: (memberKey: string) => void;
  readonly busy: boolean;
  readonly loading: boolean;
  /** The invite button, sitting with search at the head of the list. */
  readonly inviteAction?: ReactNode;
  /** Candidate E: each manager is allowed to narrow their teams' sharing, or reads it only. */
  readonly sharingGrant?: boolean;
  /** Team-wide settings under the list (invite permission, deleting the team); a person's page leaves them out. */
  readonly footer?: ReactNode;
  /**
   * A confirmation is open over the list. A person's dialog steps aside for it rather than
   * stacking under it, and comes back if the confirmation is cancelled.
   */
  readonly suspended?: boolean;
  /** Makes a team in the organization from the manager's teams; resolves to its id, or null. */
  readonly onCreateTeam?: (input: { readonly name: string; readonly parent_group_id: string | null }) => Promise<string | null>;
  /** The viewer owns the team: they make and unmake organization admins and edit them. */
  readonly viewerIsOwner?: boolean;
  /** Makes someone an organization admin, or a member again (owner only). */
  readonly onRoleChange?: (memberKey: string, role: "admin" | "member") => void;
  /** Open invite links, listed under the Invites filter with copy and revoke. */
  readonly invites?: readonly TeamInvite[];
  readonly onCopyInvite?: (invite: TeamInvite) => void;
  readonly copiedInviteId?: string | null;
  readonly onRevokeInvite?: (invite: TeamInvite) => void;
  /** Formats an invite's last day, as "10월 30일". */
  readonly formatDay?: (iso: string) => string;
  /** People who left with records still in the team (2026-10-25), listed under their own filter. */
  readonly formerMembers?: readonly { readonly member_key: string; readonly display_name: string; readonly departure: "left" | "removed"; readonly left_at: string }[];
  /** Asks to delete what a former member shared (organization admins). */
  readonly onDeleteFormer?: (memberKey: string) => void;
};

type Filter = "all" | "managers" | "invites" | "former";

const ALL_TEAMS = "__all__";

/**
 * Everyone in the team, and whom each person manages. A manager is a member
 * with a scope, so the role is set on the person: find them, open Edit,
 * choose Manager, their teams and how far they see. One list scales from a
 * team of eight to an organization of hundreds, where search and the
 * managers filter do the work a separate tab would.
 */
export function TeamRoster({ members, people, groups, managers, onManagersChange, canRemove, onRemove, busy, loading, inviteAction, sharingGrant = false, onCreateTeam, footer = null, suspended = false, viewerIsOwner = false, onRoleChange, invites, onCopyInvite, copiedInviteId = null, onRevokeInvite, formatDay, formerMembers = [], onDeleteFormer }: TeamRosterProps): JSX.Element {
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // In an organization of teams, one team or division at a time; a division keeps its teams' people.
  const [teamFilter, setTeamFilter] = useState<string>(ALL_TEAMS);
  const [editingKey, setEditing] = useState<string | null>(null);
  // Someone removed after the dialog confirms leaves the list, and their editor with them.
  const editing = editingKey !== null && members.some((member) => member.member_key === editingKey) ? editingKey : null;
  // The toolbar is pinned over the scrolling list; a hairline marks it once the list runs beneath.
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    // In the settings dialog the body scrolls; on the Settings tab the page does, and the bar pins
    // under the page's top padding, so the bar counts as pinned from there.
    const page = sentinel.closest(".team-settings-page") ? sentinel.closest<HTMLElement>(".content") : null;
    const root = page ?? sentinel.closest(".team-modal__body");
    const inset = page ? Number.parseFloat(getComputedStyle(page).paddingTop) || 0 : 0;
    const observer = new IntersectionObserver(([entry]) => setStuck(entry ? !entry.isIntersecting : false), { root, rootMargin: (-inset) + "px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  // Each person's own team for the second line; search also reads its division, so "Platform" finds its teams' people.
  const groupOf = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    return new Map(people.map((person) => {
      const group = person.group_id ? byId.get(person.group_id) ?? null : null;
      const parent = group?.parent_group_id ? byId.get(group.parent_group_id) ?? null : null;
      return [person.member_key, { name: group?.name ?? null, search: [group?.name, parent?.name].filter(Boolean).join(" ").toLocaleLowerCase() }] as const;
    }));
  }, [groups, people]);
  const managerOf = useMemo(() => new Map(managers.map((manager) => [manager.member_key, manager])), [managers]);
  const teamOptions = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const countIn = (id: string): number => people.filter((person) => {
      let current = person.group_id;
      while (current) {
        if (current === id) return true;
        current = byId.get(current)?.parent_group_id ?? null;
      }
      return false;
    }).length;
    // Divisions first, each followed by its teams named by their path, as in the sharing target menu.
    const ordered: { readonly value: string; readonly label: string; readonly statusLabel: string }[] = [];
    const add = (group: TeamGroup, parent: TeamGroup | null) => {
      ordered.push({ value: group.id, label: parent ? parent.name + " / " + group.name : group.name, statusLabel: t("team.focus.groupMeta.flat", { members: countIn(group.id) }) });
      for (const child of groups.filter((candidate) => candidate.parent_group_id === group.id)) add(child, group);
    };
    for (const top of groups.filter((group) => group.parent_group_id === null)) add(top, null);
    return [{ value: ALL_TEAMS, label: t("team.roster.allTeams"), statusLabel: t("team.focus.groupMeta.flat", { members: people.length }) }, ...ordered];
  }, [groups, people, t]);
  const inTeam = useMemo(() => {
    if (teamFilter === ALL_TEAMS) return null;
    const byId = new Map(groups.map((group) => [group.id, group]));
    return new Set(people.filter((person) => {
      let current = person.group_id;
      while (current) {
        if (current === teamFilter) return true;
        current = byId.get(current)?.parent_group_id ?? null;
      }
      return false;
    }).map((person) => person.member_key));
  }, [groups, people, teamFilter]);
  const needle = query.trim().toLocaleLowerCase();
  // Invites still waiting to be used; expired and revoked ones drop out of the list.
  const openInvites = useMemo(() => (invites ?? []).filter((invite) => invite.status === "pending"), [invites]);
  // The filter counts follow the chosen team, so "All" and "Team managers" say what that team holds.
  const teamMembers = inTeam ? members.filter((member) => inTeam.has(member.member_key)) : members;
  const teamManagerCount = teamMembers.filter((member) => managerOf.has(member.member_key)).length;
  const visible = members.filter((member) => {
    if (filter === "managers" && !managerOf.has(member.member_key)) return false;
    if (inTeam && !inTeam.has(member.member_key)) return false;
    if (!needle) return true;
    return member.display_name.toLocaleLowerCase().includes(needle) || (groupOf.get(member.member_key)?.search ?? "").includes(needle);
  });

  const saveRole = (member: TeamMember, draft: RoleDraft) => {
    // An organization admin is no team manager: the role change ends any manager assignment.
    if (draft.role === "admin") {
      if (member.membership_role !== "admin") onRoleChange?.(member.member_key, "admin");
      setEditing(null);
      return;
    }
    if (member.membership_role === "admin") onRoleChange?.(member.member_key, "member");
    const position = managers.findIndex((manager) => manager.member_key === member.member_key);
    const rest = managers.filter((manager) => manager.member_key !== member.member_key);
    if (draft.role === "member" || !draft.access) {
      onManagersChange(rest);
    } else {
      const sharing = sharingGrant ? draft.sharing ?? "view" : managers[position]?.sharing;
      const next: TeamManagerAssignment = { member_key: member.member_key, display_name: member.display_name, group_ids: groups.length > 0 ? draft.group_ids : [], access: draft.access, ...(sharing ? { sharing } : {}) };
      const at = position >= 0 ? position : rest.length;
      onManagersChange([...rest.slice(0, at), next, ...rest.slice(at)]);
    }
    setEditing(null);
  };

  function renderEditor(member: TeamMember) {
    const manager = managerOf.get(member.member_key) ?? null;
    return (
      <RoleEditor
        member={member}
        groups={groups}
        initial={member.membership_role === "admin"
          ? { role: "admin", group_ids: [], access: null, sharing: "view" }
          : manager ? { role: "manager", group_ids: manager.group_ids, access: manager.access, sharing: manager.sharing ?? "view" } : { role: "member", group_ids: [], access: null, sharing: "view" }}
        canMakeAdmin={viewerIsOwner && Boolean(onRoleChange)}
        sharingGrant={sharingGrant}
        onCreateTeam={onCreateTeam}
        canRemove={canRemove}
        busy={busy}
        // In a dialog the confirmation takes its place (see suspended); once confirmed the person leaves the list.
        onRemove={() => onRemove(member.member_key)}
        onCancel={() => setEditing(null)}
        onSave={(draft) => saveRole(member, draft)}
      />
    );
  }

  // A person is edited in one dialog over the list, as Rize's Edit member (owner decision 2026-10-19);
  // it steps aside while a confirmation is open over the list.
  const editingMember = editing !== null ? members.find((member) => member.member_key === editing) ?? null : null;
  const dialogMember = suspended ? null : editingMember;

  return (
    <div className="team-roster">
      <span ref={sentinelRef} className="team-roster__sentinel" aria-hidden="true" />
      <div className={"team-roster__tools" + (stuck ? " is-stuck" : "")}>
        <span className="projects-search team-roster__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="settings-input" type="text" placeholder={t("team.roster.search")} aria-label={t("team.roster.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </span>
        {groups.length > 0 ? (
          <SettingsSelect ariaLabel={t("team.roster.teamFilterAria")} className="projects-status-filter team-roster__team" value={teamFilter} options={teamOptions} onChange={setTeamFilter} />
        ) : null}
        <div className="team-seg team-roster__filter" role="group" aria-label={t("team.roster.filterAria")}>
          {([...(["all", "managers"] as const), ...(onRevokeInvite ? ["invites" as const] : []), ...(formerMembers.length > 0 || filter === "former" ? ["former" as const] : [])]).map((value) => (
            <button key={value} type="button" className={filter === value ? "on" : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              <span>{value === "all"
                ? t("team.roster.filterAll", { count: teamMembers.length })
                : value === "managers"
                  ? t("team.roster.filterManagers", { count: inTeam ? teamManagerCount : managers.length })
                  : value === "invites"
                    ? t("team.roster.filterInvites", { count: openInvites.length })
                    : t("team.roster.filterFormer", { count: formerMembers.length })}</span>
            </button>
          ))}
        </div>
        {inviteAction}
      </div>

      {filter === "former" ? (
        formerMembers.length === 0 ? (
          <p className="team-roster__empty">{t("team.roster.former.none")}</p>
        ) : (
          <>
            <p className="team-roster__note">{t("team.roster.former.hint")}</p>
            <ul className="team-set-members team-roster__list" aria-label={t("team.roster.former.listAria")}>
              {formerMembers.map((person) => {
                const day = formatDay ? formatDay(person.left_at) : person.left_at.slice(0, 10);
                return (
                  <li key={person.member_key} className="team-set-member team-roster__row">
                    <span className="team-roster__who">
                      <span className="team-set-member__name">{person.display_name}</span>
                      <span className="team-roster__meta">{t(person.departure === "left" ? "team.roster.former.left" : "team.roster.former.removed", { date: day })}</span>
                    </span>
                    {onDeleteFormer ? (
                      <button type="button" className="modal-btn modal-btn--ghost team-set-remove" disabled={busy} onClick={() => onDeleteFormer(person.member_key)}>
                        {t("team.roster.former.delete")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : filter === "invites" ? (
        openInvites.length === 0 ? (
          <p className="team-roster__empty">{t("team.roster.invite.none")}</p>
        ) : (
          <ul className="team-set-members team-roster__list" aria-label={t("team.roster.invite.listAria")}>
            {openInvites.map((invite) => (
              <li key={invite.invite_id} className="team-set-member team-roster__row">
                <span className="team-roster__who">
                  <span className="team-set-member__name"><code className="team-code-inline">{invite.invite_code}</code></span>
                  <span className="team-roster__meta">{t("team.roster.invite.until", { date: formatDay ? formatDay(invite.expires_at) : invite.expires_at.slice(0, 10) })}</span>
                </span>
                {onCopyInvite ? (
                  <button type="button" className="modal-btn modal-btn--ghost team-set-remove" onClick={() => onCopyInvite(invite)}>
                    {copiedInviteId === invite.invite_id ? t("team.invite.copied") : t("team.invite.copyLink")}
                  </button>
                ) : null}
                <button type="button" className="modal-btn modal-btn--ghost team-set-remove" disabled={busy} aria-label={t("team.roster.invite.revokeAria", { code: invite.invite_code })} onClick={() => onRevokeInvite?.(invite)}>
                  {t("team.roster.invite.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : loading ? (
        <p className="team-modal__hint">{t("team.settings.membersLoading")}</p>
      ) : visible.length === 0 ? (
        <p className="team-roster__empty">{needle ? t("team.roster.noMatch", { query: query.trim() }) : t("team.roster.noManagers")}</p>
      ) : (
        <ul className="team-set-members team-roster__list" aria-label={t("team.settings.members")}>
          {visible.map((member) => {
            const manager = managerOf.get(member.member_key) ?? null;
            const owner = member.membership_role === "owner";
            // Owners and admins are the organization admins; neither is a team manager to edit here.
            const orgAdmin = owner || member.membership_role === "admin";
            // The owner edits organization admins too (to take the role back); nobody edits the owner or themself.
            const editable = !owner && !member.is_self && (!orgAdmin || viewerIsOwner);
            const access = manager ? t(manager.access === "detail" ? "team.managers.access.detail" : "team.managers.access.summary") : null;
            const managed = manager ? managerTeamsLabel(manager, groups, t) : null;
            const narrows = sharingGrant && manager?.sharing === "narrow" ? t("team.managers.sharing.narrowShort") : null;
            const team = groupOf.get(member.member_key)?.name ?? null;
            // The owner is the organization admin who holds the team, so its row says so.
            const second = manager ? [managed, access, narrows].filter(Boolean).join(" · ") : owner ? [t("team.roster.owner"), team].filter(Boolean).join(" · ") : team;
            return (
              <li key={member.member_key} className="team-set-member team-roster__row">
                <span className="team-roster__who">
                  <span className="team-set-member__name">
                    {member.display_name}
                    {member.is_self ? <span className="team-set-you">{t("team.settings.you")}</span> : null}
                  </span>
                  {second ? <span className="team-roster__meta">{second}</span> : null}
                </span>
                {orgAdmin ? <span className="team-set-role--admin">{t("team.role.owner")}</span> : null}
                {manager ? <span className="team-set-role--admin">{t("team.roster.role.manager")}</span> : null}
                {editable ? (
                  <button type="button" className="modal-btn modal-btn--ghost team-set-remove" disabled={busy || editing !== null} aria-label={t("team.managers.editAria", { name: member.display_name })} onClick={() => setEditing(member.member_key)}>
                    {t("team.managers.edit")}
                  </button>
                ) : <span className="team-roster__edit-slot" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
      {footer}
      <ModalPresence onDismiss={() => setEditing(null)}>
        {dialogMember ? (
          <TeamPersonDialog name={dialogMember.display_name} meta={groupOf.get(dialogMember.member_key)?.name ?? null} onClose={() => setEditing(null)}>
            {renderEditor(dialogMember)}
          </TeamPersonDialog>
        ) : null}
      </ModalPresence>
    </div>
  );
}

/** One person's role, teams and access in a dialog over the members list, as Rize's Edit member. */
function TeamPersonDialog({ name, meta, onClose, children }: { readonly name: string; readonly meta: string | null; readonly onClose: () => void; readonly children: ReactNode }): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  useModalDismiss(onClose);
  // A role half-chosen is not lost to a stray click outside; Escape and Cancel close it.
  const overlayDismiss = useOverlayDismiss(onClose, { keepOpen: true });
  useAnchoredDialog(panelRef);
  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell team-modal team-person-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-person-title"
      >
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="team-person-title">{name}</h2>
            {meta ? <p>{meta}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}

type RoleDraft = TeamManagerDraft & { readonly role: "member" | "manager" | "admin" };

/** The new-team menu's value for a team outside any division. */
const TOP_LEVEL = "__top__";

function RoleEditor({ member, groups, initial, canMakeAdmin, sharingGrant, onCreateTeam, canRemove, busy, onRemove, onCancel, onSave }: {
  readonly member: TeamMember;
  /** The owner may make this person an organization admin. */
  readonly canMakeAdmin: boolean;
  readonly sharingGrant: boolean;
  readonly onCreateTeam?: TeamRosterProps["onCreateTeam"];
  readonly groups: readonly TeamGroup[];
  readonly initial: Omit<RoleDraft, "member_key">;
  readonly canRemove: boolean;
  readonly busy: boolean;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
  readonly onSave: (draft: RoleDraft) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const [draft, setDraft] = useState<RoleDraft>({ ...initial, member_key: member.member_key });
  const hasGroups = groups.length > 0;
  const topLevel = groups.filter((group) => group.parent_group_id === null);
  const childrenOf = (id: string) => groups.filter((group) => group.parent_group_id === id);
  const selected = new Set(draft.group_ids);
  const toggleGroup = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      // A parent includes its teams, so its children need not be listed too.
      for (const child of childrenOf(id)) next.delete(child.id);
    }
    setDraft({ ...draft, group_ids: groups.map((group) => group.id).filter((groupId) => next.has(groupId)) });
  };
  const complete = draft.role !== "manager" || isManagerDraftComplete(draft, hasGroups);
  // A team made here sits under a division when the organization has them, and joins this manager's teams.
  const divisions = topLevel.filter((group) => childrenOf(group.id).length > 0);
  const [newTeam, setNewTeam] = useState<{ readonly name: string; readonly parent: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const openNewTeam = () => {
    const home = divisions.find((division) => selected.has(division.id) || childrenOf(division.id).some((child) => selected.has(child.id)));
    setNewTeam({ name: "", parent: (home ?? divisions[0])?.id ?? TOP_LEVEL });
  };
  const createTeam = async () => {
    if (!onCreateTeam || !newTeam || !newTeam.name.trim() || creating) return;
    setCreating(true);
    const parent = newTeam.parent === TOP_LEVEL ? null : newTeam.parent;
    const id = await onCreateTeam({ name: newTeam.name.trim(), parent_group_id: parent });
    setCreating(false);
    if (!id) return;
    setNewTeam(null);
    // A division already chosen covers its new team, so only a team outside it is added.
    setDraft((current) => (parent && current.group_ids.includes(parent) ? current : { ...current, group_ids: [...current.group_ids, id] }));
  };

  return (
    // The dialog names the person in its own header.
    <div className="team-manager-editor">
      <div className="team-modal__field">
        <span className="label-mono" id={"role-" + member.member_key}>{t("team.roster.role")}</span>
        <div className="team-seg team-roster__role" role="radiogroup" aria-labelledby={"role-" + member.member_key}>
          {(canMakeAdmin ? ["member", "manager", "admin"] as const : ["member", "manager"] as const).map((role) => (
            <button key={role} type="button" role="radio" aria-checked={draft.role === role} className={draft.role === role ? "on" : undefined} onClick={() => setDraft({ ...draft, role })}>
              <span>{t(role === "member" ? "team.roster.role.member" : role === "manager" ? "team.roster.role.manager" : "team.roster.role.admin")}</span>
            </button>
          ))}
        </div>
        {draft.role === "admin" ? <p className="team-modal__hint">{t("team.roster.role.adminHint")}</p> : null}
      </div>
      {draft.role === "manager" ? (
        <>
          {/* Without groups a manager covers the whole team, so there is nothing to choose. */}
          {hasGroups ? (
            <div className="team-modal__field">
              <span className="label-mono">{t("team.managers.teams")}</span>
              <div className="team-manager-editor__groups">
                {topLevel.map((group) => {
                  const parentOn = selected.has(group.id);
                  return (
                    <div key={group.id} className="team-manager-editor__group-row">
                      <button type="button" className={"team-window__day team-manager-chip" + (parentOn ? " is-on" : "")} aria-pressed={parentOn} onClick={() => toggleGroup(group.id)}>
                        {group.name}
                      </button>
                      {childrenOf(group.id).map((child) => {
                        const on = parentOn || selected.has(child.id);
                        return (
                          <button key={child.id} type="button" className={"team-window__day team-manager-chip team-manager-chip--child" + (on ? " is-on" : "")} aria-pressed={on} disabled={parentOn} onClick={() => toggleGroup(child.id)}>
                            {child.name}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {onCreateTeam && !newTeam ? (
                  <button type="button" className="team-window__day team-manager-chip team-manager-chip--new" aria-label={t("team.managers.newTeamAria")} onClick={openNewTeam}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    <span>{t("team.managers.newTeam")}</span>
                  </button>
                ) : null}
              </div>
              {onCreateTeam && newTeam ? (
                <div className="team-manager-editor__new" role="group" aria-label={t("team.managers.newTeamAria")}>
                  <input
                    className="settings-input"
                    type="text"
                    value={newTeam.name}
                    maxLength={80}
                    placeholder={t("team.managers.newTeamName")}
                    aria-label={t("team.managers.newTeamName")}
                    autoFocus
                    onChange={(event) => setNewTeam({ ...newTeam, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void createTeam();
                      }
                    }}
                  />
                  {divisions.length > 0 ? (
                    <SettingsSelect
                      ariaLabel={t("team.managers.newTeamParent")}
                      className="projects-status-filter team-manager-editor__parent"
                      value={newTeam.parent}
                      options={[
                        ...divisions.map((division) => ({ value: division.id, label: t("team.managers.newTeamUnder", { division: division.name }) })),
                        { value: TOP_LEVEL, label: t("team.managers.newTeamTop") },
                      ]}
                      onChange={(parent) => setNewTeam({ ...newTeam, parent })}
                    />
                  ) : null}
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setNewTeam(null)}>{t("common.cancel")}</button>
                  <button type="button" className="modal-btn modal-btn--secondary" disabled={!newTeam.name.trim() || creating} onClick={() => void createTeam()}>{t("team.managers.newTeamCreate")}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="team-modal__field">
            <span className="label-mono">{t("team.managers.access")}</span>
            <div className="team-scope-list team-roster__access" role="radiogroup" aria-label={t("team.managers.access")}>
              {ACCESS_OPTIONS.map((option) => {
                const checked = draft.access === option.id;
                return (
                  <button key={option.id} type="button" role="radio" aria-checked={checked} className={"team-scope-option" + (checked ? " is-checked" : "")} onClick={() => setDraft({ ...draft, access: option.id })}>
                    <span className="team-scope-option__radio" aria-hidden="true" />
                    <span className="team-scope-option__copy">
                      <strong>{t(option.title)}</strong>
                      <span>{t(option.body)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {sharingGrant ? (
            <div className="team-modal__field">
              <span className="label-mono">{t("team.managers.sharing")}</span>
              <div className="team-scope-list team-roster__access" role="radiogroup" aria-label={t("team.managers.sharing")}>
                {SHARING_OPTIONS.map((option) => {
                  const checked = (draft.sharing ?? "view") === option.id;
                  return (
                    <button key={option.id} type="button" role="radio" aria-checked={checked} className={"team-scope-option" + (checked ? " is-checked" : "")} onClick={() => setDraft({ ...draft, sharing: option.id })}>
                      <span className="team-scope-option__radio" aria-hidden="true" />
                      <span className="team-scope-option__copy">
                        <strong>{t(option.title)}</strong>
                        <span>{t(option.body)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="team-manager-editor__actions">
        {canRemove ? (
          <button type="button" className="modal-btn team-manager-editor__remove modal-btn--ghost team-roster__remove" disabled={busy} onClick={onRemove}>
            {t("team.roster.removeFromTeam")}
          </button>
        ) : null}
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onCancel}>
          {t("common.cancel")}
          <KeyHint shortcut="escape" />
        </button>
        <button type="button" className="modal-btn modal-btn--primary" disabled={!complete || busy} onClick={() => onSave(draft)}>{t("team.managers.save")}</button>
      </div>
    </div>
  );
}
