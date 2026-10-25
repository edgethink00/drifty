import { useEffect, useState } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { TEAM_SHARE_FIELDS, compareTeamSharingPolicies, type TeamShareField, type TeamSharingPolicy } from "./teamSharingPolicy";

const STORAGE_PREFIX = "drifty.team.sharingSeen.v1:";

/** The team's sharing as this person last saw it, on this device. */
export function readSeenTeamSharing(organizationId: string): TeamSharingPolicy | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + organizationId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TeamSharingPolicy>;
    return TEAM_SHARE_FIELDS.every((field) => typeof parsed[field] === "string") ? (parsed as TeamSharingPolicy) : null;
  } catch {
    return null;
  }
}

export function writeSeenTeamSharing(organizationId: string, policy: TeamSharingPolicy): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + organizationId, JSON.stringify(policy));
  } catch {
    // Seen-state is a courtesy; without storage the notice simply shows again.
  }
}

/** The items a team now shares more of than this person last saw; seeing more of the team is not one. */
export function widenedTeamShareFields(seen: TeamSharingPolicy | null, current: TeamSharingPolicy): readonly TeamShareField[] {
  if (!seen) return [];
  return compareTeamSharingPolicies(seen, current).widened.filter((item): item is TeamShareField => item !== "memberSummary");
}

export type TeamSharingNoticeProps = {
  readonly organizationId: string;
  readonly policy: TeamSharingPolicy;
  /** "Focus time, Work titles" for the items. */
  readonly itemsLabel: (fields: readonly TeamShareField[]) => string;
  readonly onOpenSettings: () => void;
};

/**
 * Review-80 open question 6, settled 2026-10-23 (recommendation B): when the team starts sharing
 * more of someone's records, they read it once, the next time they open the team, with what widened
 * and that only records from then on are shared. Narrowing needs no notice. The first visit only
 * records what the person joined with, which the join screen already showed them.
 */
export function TeamSharingNotice({ organizationId, policy, itemsLabel, onOpenSettings }: TeamSharingNoticeProps): JSX.Element | null {
  const { t } = useLocalization();
  const [seen, setSeen] = useState<TeamSharingPolicy | null>(() => readSeenTeamSharing(organizationId));
  const widened = widenedTeamShareFields(seen, policy);
  useEffect(() => {
    // Nothing seen yet, or nothing wider than before: today's sharing becomes what was seen.
    if (seen === null || widenedTeamShareFields(seen, policy).length === 0) {
      writeSeenTeamSharing(organizationId, policy);
      if (seen === null || JSON.stringify(seen) !== JSON.stringify(policy)) setSeen(policy);
    }
  }, [organizationId, policy, seen]);
  if (widened.length === 0) return null;
  const acknowledge = () => {
    writeSeenTeamSharing(organizationId, policy);
    setSeen(policy);
  };
  return (
    <section className="team-scheduled team-sharing-notice" role="status" aria-label={t("team.notice.widenedTitle")}>
      <div className="team-form-rows">
        <div className="team-form-row">
          <div className="team-form-row__copy">
            <strong>{t("team.notice.widenedTitle")}</strong>
            <span>{t("team.notice.widenedBody", { items: itemsLabel(widened) })}</span>
          </div>
          <div className="team-form-row__control">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={() => { acknowledge(); onOpenSettings(); }}>{t("team.notice.settings")}</button>
            <button type="button" className="modal-btn modal-btn--secondary" onClick={acknowledge}>{t("team.notice.ok")}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
