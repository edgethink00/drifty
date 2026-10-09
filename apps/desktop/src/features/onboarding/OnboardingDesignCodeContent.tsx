import { useRef, useState, type FormEvent } from "react";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import type { OnboardingFlow } from "./useOnboardingFlow";
import { isOnboardingEntryStep } from "./onboardingFlow";
import { OnboardingEntryStep } from "./components/steps/OnboardingEntryStep";
import { JobStep } from "./components/steps/JobStep";
import { PermissionsStep } from "./components/steps/PermissionsStep";
import { AccessibilitySettingsPreview } from "./components/AccessibilitySettingsPreview";
import { SetupChoiceStep } from "./components/steps/SetupChoiceStep";
import { ConnectServerStep } from "./components/steps/ConnectServerStep";
import { TestConnectionStep } from "./components/steps/TestConnectionStep";
import { SelfDataReviewStep } from "./components/steps/SelfDataReviewStep";
import { ReadyStep } from "./components/steps/ReadyStep";
import { useLocalization } from "../localization/LocalizationContext";
import { useScrollOverflowEdges } from "./useScrollOverflowEdges";

type OnboardingDesignCodeContentProps = {
  readonly flow: OnboardingFlow;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly onStartCloudTrialWithGoogle: () => void;
  readonly onStartCloudTrialWithWebsite?: () => void;
  readonly onDeleteAnonymousAccount?: () => void;
};

export function OnboardingDesignCodeContent(props: OnboardingDesignCodeContentProps) {
  if (isOnboardingEntryStep(props.flow.step)) {
    return (
      <OnboardingEntryStep
        flow={props.flow}
        authCallbackStatus={props.authCallbackStatus}
        onStartCloudTrialWithGoogle={props.onStartCloudTrialWithGoogle}
        onStartCloudTrialWithWebsite={props.onStartCloudTrialWithWebsite}
        onDeleteAnonymousAccount={props.onDeleteAnonymousAccount}
      />
    );
  }
  return <OnboardingSetupStepContent flow={props.flow} />;
}

function OnboardingSetupStepContent({
  flow,
}: {
  readonly flow: OnboardingFlow;
}) {
  const { t } = useLocalization();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blockedContinueStep, setBlockedContinueStep] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollEdges = useScrollOverflowEdges(scrollRef, flow.step);

  const title = flow.title;
  // The entry screen is not a setup step: the dots count from Work, and Work has no Back.
  const showBack = flow.setupStepIndex > 0;
  // Errors sit next to the button they explain. In the fixed 900x580
  // onboarding window, text appended to the end of a long step lands below
  // the fold where nobody sees it. Permissions always says why Continue is
  // off. Work has no on-screen reason either, so its Continue stays pressable
  // (aria-disabled) and explains itself only after a press; other steps
  // explain themselves in their own copy and must not nag before input.
  const workContinueBlocked = flow.step === "job" && !flow.canAdvance && !flow.isCompleting;
  const footerError = flow.storageError ?? flow.setupError;
  const footerHint = flow.step === "permissions"
    ? flow.blockedHint
    : workContinueBlocked && blockedContinueStep === flow.step
      ? t("onboarding.block.workContext")
      : null;
  const footerLabel = flow.isCompleting
    ? t("onboarding.action.finishing")
    : flow.footerLabel;
  const selectedActivities = flow.mainActivities;

  const advancedVisible = advancedOpen || flow.isUserManagedProviderSetup;
  const contentClassName = "dc-onb-content";
  // macOS Permissions shows the Accessibility list it is asking for beside the step copy;
  // the path to it sits under the picture until access is granted.
  const showPermissionsPreview = flow.step === "permissions" && flow.accessibilityRequired;

  function handleActivityToggle(option: string) {
    if (selectedActivities.includes(option)) {
      flow.toggleMainActivity(option);
      if (flow.workType === option) {
        flow.setWorkType(selectedActivities.find((activity) => activity !== option) ?? null);
      }
      return;
    }
    flow.addMainActivity(option);
    if (!flow.workType) flow.setWorkType(option);
  }



  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (workContinueBlocked) {
      event.preventDefault();
      setBlockedContinueStep(flow.step);
      return;
    }
    flow.handleSubmit(event);
  }

  return (
    <>
      <form
        className="onboarding-card dc-onb-card"
        data-step={flow.step}
        data-preview={showPermissionsPreview ? "true" : undefined}
        onSubmit={handleSubmit}
        aria-busy={flow.isCompleting}
      >
        <div className="dc-onb-scroll" ref={scrollRef} data-overflow={scrollEdges}>
          <div className={contentClassName}>
            {flow.step === "ready" ? (
              <span className="dc-onb-ready-seal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg></span>
            ) : null}
            <h1 className="dc-onb-title" id="onboarding-title" ref={flow.titleRef} tabIndex={-1}>
              {title}
            </h1>
            {flow.step === "choose_setup" ? (
              <p className="dc-onb-subtitle">{t("onboarding.setup.subtitle")}</p>
            ) : null}

            <div className="onboarding-step dc-onb-step" key={flow.step} ref={flow.stepBodyRef}>
              {flow.step === "job" ? (
                <JobStep
                  selectedActivities={selectedActivities}
                  workDescription={flow.workDescription}
                  onToggleActivity={handleActivityToggle}
                  onWorkDescriptionChange={flow.setWorkDescription}
                />
              ) : null}
              {flow.step === "permissions" ? <PermissionsStep flow={flow} /> : null}
              {flow.step === "choose_setup" ? (
                <SetupChoiceStep
                  advancedVisible={advancedVisible}
                  flow={flow}
                  onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
                />
              ) : null}
              {flow.step === "connect_server" ? <ConnectServerStep flow={flow} /> : null}
              {flow.step === "test_connection" ? <TestConnectionStep flow={flow} /> : null}
              {flow.step === "self_data_review" ? <SelfDataReviewStep flow={flow} /> : null}
              {flow.step === "ready" ? <ReadyStep flow={flow} /> : null}
            </div>
          </div>
        </div>
        {/* The panel sits on the card, outside the scroll column, so it can meet the window's
            top and right edges like the entry stage instead of being clipped by the scroll fade. */}
        {showPermissionsPreview ? (
          <aside className="onb-ax-aside">
            <AccessibilitySettingsPreview granted={flow.accessibilityGranted} />
            {flow.accessibilityGranted ? null : (
              <p className="onb-ax-aside__caption">{t("onboarding.permissions.accessibilityRecoveryBody")}</p>
            )}
          </aside>
        ) : null}

        {footerError ? (
          <p className="dc-onb-footer-status dc-onb-footer-status--error" role="alert">
            {footerError}
          </p>
        ) : (
          <p className="dc-onb-footer-status" aria-live="polite">{footerHint}</p>
        )}
        <div className="onb-actions dc-onb-actions">
          {showBack ? (
            <button
              type="button"
              className="onb-actions__back dc-onb-back"
              onClick={flow.goToPreviousStep}
              disabled={flow.isCompleting}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14.5 6-6 6 6 6" />
              </svg>
              {t("common.back")}
            </button>
          ) : null}
          <div className="onb-actions__dots dc-onb-dots" aria-hidden="true">
            {flow.setupSteps.map((stepDef, index) => (
              <span
                key={stepDef.id}
                className={`onb-actions__dot dc-onb-dot${index === flow.setupStepIndex ? " onb-actions__dot--active dc-onb-dot--active" : ""}`}
              />
            ))}
          </div>
          <span className="dc-onb-actions-spacer" />
          <button
            type="submit"
            className="onb-button onb-button--primary dc-onb-primary"
            disabled={!workContinueBlocked && (!flow.canAdvance || flow.isCompleting)}
            aria-disabled={workContinueBlocked || undefined}
          >
            {footerLabel}
          </button>
        </div>
      </form>
    </>
  );
}
