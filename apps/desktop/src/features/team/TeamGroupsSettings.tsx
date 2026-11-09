import { useMemo, useRef, useState } from "react";

import { KeyHint } from "../../components/KeyHint";
import { ModalPresence } from "../../components/ModalPresence";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "../settings/SettingsSelect";
import type { TeamManagerAssignment } from "./teamSharingPolicy";
import type { TeamGroup } from "./teamTypes";

/** The parent menu's value for a team outside any division. */
const TOP_LEVEL = "__top__";
const VISIBLE_MANAGERS = 2;

export type TeamGroupsSettingsProps = {
  readonly groups: readonly TeamGroup[];
  readonly managers: readonly TeamManagerAssignment[];
  readonly busy: boolean;
  /** A confirmation is open over the list; the team's dialog steps aside for it. */
  readonly suspended: boolean;
  readonly onCreate?: (input: { readonly name: string; readonly parent_group_id: string | null }) => Promise<string | null>;
  readonly onRename?: (groupId: string, name: string) => Promise<boolean>;
  readonly onMove?: (groupId: string, parentGroupId: string | null) => Promise<boolean>;
  /** Asks to delete a team; the caller confirms where its people go. */
  readonly onDelete: (groupId: string) => void;
};

/**
 * Settings › Teams (owner decision 2026-10-23, candidate A): the organization's divisions and teams
 * in one list, as Rize's Settings › Teams and RescueTime's Organization Settings › Teams keep them,
 * with a new team at the head and each team edited in a dialog over the list (name, division, delete),
 * as a person is in Members.
 */
export function TeamGroupsSettings({ groups, managers, busy, suspended, onCreate, onRename, onMove, onDelete }: TeamGroupsSettingsProps): JSX.Element {
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [newTeam, setNewTeam] = useState<{ readonly name: string; readonly parent: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const topLevel = groups.filter((group) => group.parent_group_id === null);
  const childrenOf = (id: string) => groups.filter((group) => group.parent_group_id === id);
  // A division is a top-level team that holds teams; a new team may go under one.
  const divisions = topLevel.filter((group) => childrenOf(group.id).length > 0);
  const managersOf = useMemo(() => {
    const byGroup = new Map<string, string[]>();
    for (const manager of managers) {
      for (const id of manager.group_ids) byGroup.set(id, [...(byGroup.get(id) ?? []), manager.display_name]);
    }
    return byGroup;
  }, [managers]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (group: TeamGroup) => !needle || group.name.toLocaleLowerCase().includes(needle);
  // A division stays in view while any of its teams matches, so a found team keeps its place.
  const shown = topLevel.filter((group) => matches(group) || childrenOf(group.id).some(matches));
  const editing = editingId ? groups.find((group) => group.id === editingId) ?? null : null;

  const meta = (group: TeamGroup) => {
    const teams = childrenOf(group.id).length;
    const names = managersOf.get(group.id) ?? [];
    const managed = names.length > 0
      ? t("team.groups.managers", { names: names.slice(0, VISIBLE_MANAGERS).join(", ") + (names.length > VISIBLE_MANAGERS ? " " + t("team.managers.more", { count: names.length - VISIBLE_MANAGERS }) : "") })
      : null;
    return [t("team.focus.groupMeta.flat", { members: group.member_count }), teams > 0 ? t("team.groups.teamCount", { count: teams }) : null, managed].filter(Boolean).join(" · ");
  };
  const create = async () => {
    if (!onCreate || !newTeam || !newTeam.name.trim() || creating) return;
    setCreating(true);
    const id = await onCreate({ name: newTeam.name.trim(), parent_group_id: newTeam.parent === TOP_LEVEL ? null : newTeam.parent });
    setCreating(false);
    if (id) setNewTeam(null);
  };
  const row = (group: TeamGroup, child: boolean) => (
    <li key={group.id} className={"team-set-member team-roster__row team-groups__row" + (child ? " team-groups__row--child" : "")}>
      <span className="team-roster__who">
        <span className="team-set-member__name">{group.name}</span>
        <span className="team-roster__meta">{meta(group)}</span>
      </span>
      <button type="button" className="modal-btn modal-btn--ghost team-set-remove" disabled={busy || editingId !== null} aria-label={t("team.groups.editAria", { name: group.name })} onClick={() => setEditingId(group.id)}>
        {t("team.managers.edit")}
      </button>
    </li>
  );

  return (
    <div className="team-roster team-groups">
      <div className="team-roster__tools">
        <span className="projects-search team-roster__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="settings-input" type="text" placeholder={t("team.groups.search")} aria-label={t("team.groups.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </span>
        {onCreate ? (
          <button type="button" className="modal-btn modal-btn--secondary team-set-invite" disabled={newTeam !== null} onClick={() => setNewTeam({ name: "", parent: divisions[0]?.id ?? TOP_LEVEL })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {t("team.groups.new")}
          </button>
        ) : null}
      </div>
      {onCreate && newTeam ? (
        <div className="team-manager-editor__new team-groups__new" role="group" aria-label={t("team.managers.newTeamAria")}>
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
                void create();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setNewTeam(null);
              }
            }}
          />
          {divisions.length > 0 ? (
            <SettingsSelect
              ariaLabel={t("team.managers.newTeamParent")}
              className="projects-status-filter team-manager-editor__parent"
              value={newTeam.parent}
              options={[...divisions.map((division) => ({ value: division.id, label: t("team.managers.newTeamUnder", { division: division.name }) })), { value: TOP_LEVEL, label: t("team.managers.newTeamTop") }]}
              onChange={(parent) => setNewTeam({ ...newTeam, parent })}
            />
          ) : null}
          <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setNewTeam(null)}>{t("common.cancel")}</button>
          <button type="button" className="modal-btn modal-btn--secondary" disabled={!newTeam.name.trim() || creating} onClick={() => void create()}>{t("team.managers.newTeamCreate")}</button>
        </div>
      ) : null}
      {groups.length === 0 ? (
        <p className="team-roster__empty">{t("team.groups.none")} {t("team.groups.noneHint")}</p>
      ) : shown.length === 0 ? (
        <p className="team-roster__empty">{t("team.groups.noMatch", { query: query.trim() })}</p>
      ) : (
        <ul className="team-set-members team-roster__list" aria-label={t("team.settings.tab.teams")}>
          {shown.flatMap((group) => [row(group, false), ...childrenOf(group.id).filter((child) => !needle || matches(group) || matches(child)).map((child) => row(child, true))])}
        </ul>
      )}
      <ModalPresence onDismiss={() => setEditingId(null)}>
        {editing && !suspended ? (
          <TeamGroupDialog
            key={editing.id}
            group={editing}
            hasTeams={childrenOf(editing.id).length > 0}
            divisions={topLevel.filter((candidate) => candidate.id !== editing.id)}
            busy={busy}
            onClose={() => setEditingId(null)}
            onSave={async (name, parent) => {
              const renamed = name !== editing.name && onRename ? await onRename(editing.id, name) : true;
              const moved = parent !== editing.parent_group_id && onMove ? await onMove(editing.id, parent) : true;
              if (renamed && moved) setEditingId(null);
            }}
            onDelete={() => onDelete(editing.id)}
          />
        ) : null}
      </ModalPresence>
    </div>
  );
}

/** One team's name and division, and deleting it, in a dialog over the list. */
function TeamGroupDialog({ group, hasTeams, divisions, busy, onClose, onSave, onDelete }: {
  readonly group: TeamGroup;
  readonly hasTeams: boolean;
  readonly divisions: readonly TeamGroup[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (name: string, parent: string | null) => Promise<void>;
  readonly onDelete: () => void;
}): JSX.Element {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(group.name);
  const [parent, setParent] = useState(group.parent_group_id ?? TOP_LEVEL);
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose, { keepOpen: true });
  useAnchoredDialog(panelRef);
  const trimmed = name.trim();
  const changed = trimmed !== group.name || (parent === TOP_LEVEL ? null : parent) !== group.parent_group_id;
  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section ref={panelRef} className="auth-modal modal-shell team-modal team-person-modal" data-modal-variant="standard" role="dialog" aria-modal="true" aria-labelledby="team-group-title">
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="team-group-title">{group.name}</h2>
            <p>{t("team.focus.groupMeta.flat", { members: group.member_count })}</p>
          </div>
        </div>
        <div className="team-manager-editor">
          <label className="team-modal__field">
            <span className="label-mono">{t("team.groups.name")}</span>
            <input className="settings-input" type="text" value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>
          {/* Two levels at most: a team that holds teams stays at the top. */}
          {hasTeams ? null : (
            <div className="team-modal__field">
              <span className="label-mono">{t("team.groups.parent")}</span>
              <SettingsSelect
                ariaLabel={t("team.groups.parent")}
                className="projects-status-filter team-groups__parent"
                value={parent}
                disabled={busy}
                options={[{ value: TOP_LEVEL, label: t("team.managers.newTeamTop") }, ...divisions.map((division) => ({ value: division.id, label: t("team.managers.newTeamUnder", { division: division.name }) }))]}
                onChange={setParent}
              />
            </div>
          )}
          <div className="team-manager-editor__actions">
            <button type="button" className="modal-btn team-manager-editor__remove modal-btn--ghost team-roster__remove" disabled={busy || hasTeams} title={hasTeams ? t("team.groups.deleteBlocked") : undefined} onClick={onDelete}>
              {t("team.groups.delete")}
            </button>
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              {t("common.cancel")}
              <KeyHint shortcut="escape" />
            </button>
            <button type="button" className="modal-btn modal-btn--primary" disabled={busy || !trimmed || !changed} onClick={() => void onSave(trimmed, parent === TOP_LEVEL ? null : parent)}>{t("team.general.save")}</button>
          </div>
          {hasTeams ? <p className="team-modal__hint">{t("team.groups.deleteBlocked")}</p> : null}
        </div>
      </section>
    </div>
  );
}
