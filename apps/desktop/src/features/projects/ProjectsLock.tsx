import { useLocalization } from "../localization/LocalizationContext";
import type { ProjectsLockReason } from "./projectsLockTypes";

type StripAction = { readonly label: string; readonly run: () => void };

/** One slim line over the page: what is going on, and the way forward. */
export function ProjectsStrip({ text, primary, secondary }: {
  readonly text: string;
  readonly primary: StripAction;
  readonly secondary?: StripAction | null;
}) {
  return (
    <div className="projects-stopped" role="status">
      <span className="projects-stopped__dot" aria-hidden="true" />
      <span className="projects-stopped__text">{text}</span>
      <span className="projects-stopped__actions">
        {secondary ? <button type="button" className="projects-stopped__link" onClick={secondary.run}>{secondary.label}</button> : null}
        <button type="button" className="projects-stopped__go" onClick={primary.run}>{primary.label}</button>
      </span>
    </div>
  );
}

/** The reason and what it means for new activity, in one sentence. */
const STOPPED_LINE = {
  "trial-ended": "projects.stopped.trialEndedLine",
  "plan-ended": "projects.stopped.planEndedLine",
  payment: "projects.stopped.paymentLine",
  "device-limit": "projects.stopped.deviceLimitLine",
  "signed-out": "projects.stopped.signedOutLine",
  disconnected: "projects.stopped.disconnectedLine",
} as const satisfies Record<ProjectsLockReason, string>;

/**
 * Over the list once projects stop gathering time: why (the trial or plan
 * ended, payment, the device limit, signed out, a key removed) and the way
 * back, in one slim line. Drifty Cloud leads where it is the way back; your
 * own key is the other way.
 */
export function ProjectsReconnect({ reason, onPickCloud, onOpenSettings }: {
  readonly reason: ProjectsLockReason;
  readonly onPickCloud: () => void;
  readonly onOpenSettings: () => void;
}) {
  const { t } = useLocalization();
  const cloudLeads = reason === "trial-ended" || reason === "plan-ended" || reason === "signed-out";
  const primary = cloudLeads
    ? { label: t(reason === "signed-out" ? "projects.reconnect.signIn" : "projects.reconnect.seePlans"), run: onPickCloud }
    : { label: t(reason === "disconnected" ? "projects.reconnect.reconnect" : "projects.reconnect.checkCloud"), run: onOpenSettings };
  const secondary = cloudLeads ? { label: t("projects.reconnect.ownKey"), run: onOpenSettings } : null;
  return <ProjectsStrip text={t(STOPPED_LINE[reason])} primary={primary} secondary={secondary} />;
}
