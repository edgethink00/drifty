import { useState, type ReactNode } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { TeamPolicySummary } from "./TeamPolicySummary";
import { TeamSharingPolicyEditor, TeamSharingWindowEditor } from "./TeamSharingPolicyEditor";
import { TEAM_SHARING_EDITOR } from "./teamPreviewScenarios";
import {
  DEFAULT_TEAM_SHARING_DRAFT,
  completeTeamSharingPolicy,
  isValidSharingWindow,
  type TeamSharingPolicyDraft,
  type TeamSharingWindow,
} from "./teamSharingPolicy";
import { defaultTeamRecordingSchedule, type TeamTrackingPolicy } from "./teamSharingScope";
import type { TeamCreateWithPolicyInput } from "./useTeamController";

const STEPS = ["name", "sharing", "hours", "review"] as const;
type WizardStep = (typeof STEPS)[number];

const STEP_KEYS: Readonly<Record<WizardStep, TranslationKey>> = {
  name: "team.create.step.name",
  sharing: "team.create.step.sharing",
  hours: "team.create.step.hours",
  review: "team.create.step.review",
};

export type TeamCreateWizardProps = {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly previewNote: boolean;
  readonly onCancel: () => void;
  /** The dialog that owns Escape supplies its key hint for the cancel button. */
  readonly escapeHint?: ReactNode;
  readonly onCreate: (input: TeamCreateWithPolicyInput) => Promise<boolean>;
  /** The team exists: the owner hands over to the invite dialog, email first. */
  readonly onCreated: () => void;
  /** Closes the wizard after a team was made but something after it failed. */
  readonly onDone: () => void;
  /** A Dev preview candidate: the hours step says whose clock the hours follow. */
  readonly zoneChoice?: boolean;
};

/**
 * Creating a team in steps: its name, what it shares, its hours and a review of
 * what invitees will read. Creating it opens the same invite dialog as Invite
 * teammate (email first, link second), which also makes the team's link. No
 * item or pausing rule is chosen for the admin; each step continues only once
 * its choices are made.
 */
export function TeamCreateWizard({
  name,
  onNameChange,
  busy,
  error,
  previewNote,
  onCancel,
  escapeHint,
  zoneChoice = false,
  onCreate,
  onCreated,
  onDone,
}: TeamCreateWizardProps): JSX.Element {
  const { t } = useLocalization();
  const [step, setStep] = useState<WizardStep>("name");
  // A new team starts on the decided default (2026-10-20): work records by time of day, focus off, members see their own records.
  const [draft, setDraft] = useState<TeamSharingPolicyDraft>(DEFAULT_TEAM_SHARING_DRAFT);
  const [hours, setHours] = useState<TeamSharingWindow>(defaultTeamRecordingSchedule);
  const [tracking, setTracking] = useState<TeamTrackingPolicy | null>(null);
  // Once the team exists it is never created again from here, even if a later step failed.
  const [created, setCreated] = useState(false);
  const policy = completeTeamSharingPolicy(draft);
  const stepIndex = STEPS.indexOf(step);
  const canContinue = step === "name"
    ? name.trim().length > 0
    : step === "sharing"
      ? policy !== null
      : step === "hours"
        ? tracking !== null && isValidSharingWindow(hours)
        : true;
  const pendingHint: TranslationKey | null = canContinue ? null : step === "name" ? null : step === "sharing" ? "team.create.needSharing" : "team.create.needHours";

  const next = async () => {
    if (!canContinue || busy || created) return;
    if (step === "review") {
      if (!policy || !tracking) return;
      const made = await onCreate({ organizationName: name.trim(), policy, window: hours, trackingPolicy: tracking });
      if (made) {
        setCreated(true);
        onCreated();
      }
      return;
    }
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!);
  };

  return (
    <div className="team-wizard">
      <ol className="team-steps" aria-label={t("team.create.stepsAria")}>
        {STEPS.map((candidate, index) => (
          <li key={candidate} className={"team-steps__item" + (index < stepIndex ? " is-done" : index === stepIndex ? " is-current" : "")} aria-current={index === stepIndex ? "step" : undefined}>
            <span className="team-steps__num" aria-hidden="true">{index < stepIndex ? "✓" : index + 1}</span>
            <span>{t(STEP_KEYS[candidate])}</span>
          </li>
        ))}
      </ol>

      <div className="team-wizard__body">
        {step === "name" ? (
          <div className="team-modal__field">
            <span className="label-mono">{t("team.add.name")}</span>
            <input
              className="settings-input"
              placeholder={t("team.add.namePlaceholder")}
              value={name}
              maxLength={120}
              aria-label={t("team.add.name")}
              autoFocus
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) void next();
              }}
            />
            <p className="team-modal__hint">{t("team.create.nameHint")}</p>
          </div>
        ) : null}

        {step === "sharing" ? (
          <>
            <p className="team-wizard__intro">{TEAM_SHARING_EDITOR.read() !== "table" ? t("team.create.sharingIntroShort") : t("team.create.sharingIntro")}</p>
            <TeamSharingPolicyEditor draft={draft} onChange={setDraft} idPrefix="team-create-policy" />
          </>
        ) : null}

        {step === "hours" ? (
          <TeamSharingWindowEditor window={hours} onWindowChange={setHours} tracking={tracking} onTrackingChange={setTracking} idPrefix="team-create-hours" zoneChoice={zoneChoice} />
        ) : null}

        {step === "review" && policy && tracking ? (
          <>
            <p className="team-wizard__intro">{t("team.create.reviewIntro", { team: name.trim() })}</p>
            <TeamPolicySummary policy={policy} window={hours} tracking={tracking} showZone={zoneChoice} />
          </>
        ) : null}

        {/* Said once, where the team would be created. */}
        {previewNote && step === "review" ? <p className="team-modal__hint team-wizard__preview">{t("team.create.previewNote")}</p> : null}
        {error ? <p className="team-message team-message--error">{error}</p> : null}
      </div>

      <div className="modal-foot team-modal__actions team-wizard__actions">
        {pendingHint ? <span className="team-wizard__pending">{t(pendingHint)}</span> : null}
        {created ? (
          <button type="button" className="modal-btn modal-btn--primary" onClick={onDone}>{t("team.create.done")}</button>
        ) : (
          <>
            {stepIndex === 0 ? (
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onCancel}>{t("common.cancel")}{escapeHint}</button>
            ) : (
              <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setStep(STEPS[stepIndex - 1]!)}>{t("team.create.back")}</button>
            )}
            <button type="button" className="modal-btn modal-btn--primary" disabled={!canContinue || busy} onClick={() => void next()}>
              {step === "review" ? t("team.add.create") : t("team.create.next")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
