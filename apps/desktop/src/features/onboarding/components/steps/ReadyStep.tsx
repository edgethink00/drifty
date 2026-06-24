import type { CloudTrialStartedNoticeModel } from "../../../billing/CloudTrialStartedNotice";
import { StartupLoginPreference } from "../StartupLoginPreference";
import type { SetupChoice } from "../../onboardingFlow";

type ReadyStepProps = {
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly localAiSummaryLabel: string;
  readonly openAtLoginEnabled: boolean;
  readonly permissionSummaryLabel: string;
  readonly setupChoice: SetupChoice | null;
  readonly userManagedConnectionLabel: string;
  readonly userManagedSetupLabel: string;
  readonly isUserManagedProviderSetup: boolean;
  readonly onOpenAtLoginChange: (enabled: boolean) => void;
};

export function ReadyStep({
  cloudTrialStartedNotice,
  isUserManagedProviderSetup,
  localAiSummaryLabel,
  openAtLoginEnabled,
  permissionSummaryLabel,
  setupChoice,
  userManagedConnectionLabel,
  userManagedSetupLabel,
  onOpenAtLoginChange,
}: ReadyStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        Drifty will now track your focus and drift in the background while you work.
      </p>
      {setupChoice === "local_ai" || isUserManagedProviderSetup ? (
        <ul className="onb-summary" aria-label="Setup summary">
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            {setupChoice === "local_ai" ? "Local AI selected" : userManagedSetupLabel}
          </li>
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            {setupChoice === "local_ai" ? localAiSummaryLabel : userManagedConnectionLabel}
          </li>
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            {permissionSummaryLabel}
          </li>
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            Tracking ready
          </li>
        </ul>
      ) : (
        <ul className="onb-summary" aria-label="Setup summary">
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            Drifty Cloud selected
          </li>
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            Account connected
          </li>
          {cloudTrialStartedNotice ? (
            <li className="onb-summary__item onb-summary__item--stacked">
              <span className="onb-summary__check" aria-hidden="true" />
              <span>
                <strong>1-week free trial started</strong>
                <small>{cloudTrialStartedNotice.detail}</small>
              </span>
            </li>
          ) : null}
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            {permissionSummaryLabel}
          </li>
          <li className="onb-summary__item">
            <span className="onb-summary__check" aria-hidden="true" />
            Tracking ready
          </li>
        </ul>
      )}
      <StartupLoginPreference enabled={openAtLoginEnabled} onChange={onOpenAtLoginChange} />
      <p className="onb-account__helper">You can pause Drifty any time from the menu bar.</p>
    </>
  );
}
