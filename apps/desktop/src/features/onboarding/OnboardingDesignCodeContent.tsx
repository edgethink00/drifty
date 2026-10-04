import { useRef, useState, type FormEvent } from "react";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import type { OnboardingFlow } from "./useOnboardingFlow";
import { WelcomeStep } from "./components/steps/WelcomeStep";
import { AccountStep } from "./components/steps/AccountStep";
import { JobStep } from "./components/steps/JobStep";
import { PermissionsStep } from "./components/steps/PermissionsStep";
import { SetupChoiceStep } from "./components/steps/SetupChoiceStep";
import { ConnectServerStep } from "./components/steps/ConnectServerStep";
import { TestConnectionStep } from "./components/steps/TestConnectionStep";
import { SelfDataReviewStep } from "./components/steps/SelfDataReviewStep";
import { ReadyStep } from "./components/steps/ReadyStep";
import { OnboardingLanguageToggle } from "./components/OnboardingLanguageToggle";
import { useLocalization } from "../localization/LocalizationContext";
import { DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../appFeatureSwitches";
import { useScrollOverflowEdges } from "./useScrollOverflowEdges";

type OnboardingDesignCodeContentProps = {
  readonly flow: OnboardingFlow;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
  readonly onStartCloudTrialWithWebsite?: () => void;
  readonly onDeleteAnonymousAccount?: () => void;
};

export function OnboardingDesignCodeContent({
  flow,
  authCallbackStatus,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithWebsite,
  onDeleteAnonymousAccount,
}: OnboardingDesignCodeContentProps) {
  const { t } = useLocalization();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blockedContinueStep, setBlockedContinueStep] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollEdges = useScrollOverflowEdges(scrollRef, flow.step);

  const title = flow.title;
  const showTitle = flow.step !== "welcome" && flow.step !== "account";
  const showFooter = flow.step !== "account";
  const showDots = flow.step !== "welcome" && flow.step !== "account";
  const showBack = flow.stepIndex > 0;
  // Errors sit next to the button they explain. In the fixed 720x540
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
  const contentClassName = [
    "dc-onb-content",
    flow.step === "account" ? "dc-onb-content--account" : "",
    flow.step === "welcome" ? "dc-onb-content--welcome" : "",
  ].filter(Boolean).join(" ");

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
        onSubmit={handleSubmit}
        aria-busy={flow.isCompleting}
      >
        <div className="dc-onb-scroll" ref={scrollRef} data-overflow={scrollEdges}>
          <div className={contentClassName}>
            {flow.step === "ready" ? (
              <span className="dc-onb-ready-seal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg></span>
            ) : null}
            {showTitle ? (
              <h1 className="dc-onb-title" id="onboarding-title" ref={flow.titleRef} tabIndex={-1}>
                {title}
              </h1>
            ) : (
              <h1 className="onb-visually-hidden" id="onboarding-title" ref={flow.titleRef} tabIndex={-1}>
                {title}
              </h1>
            )}
            {flow.step === "choose_setup" ? (
              <p className="dc-onb-subtitle">{t("onboarding.setup.subtitle")}</p>
            ) : null}

            <div className="onboarding-step dc-onb-step" key={flow.step} ref={flow.stepBodyRef}>
              {flow.step === "welcome" ? (
                <WelcomeStep promotionActive={flow.promotionActive} promotionEndsAt={flow.promotionEndsAt} />
              ) : null}
              {flow.step === "account" ? (
                <AccountStep
                  accountConnected={flow.accountConnected}
                  accountAccessState={flow.accountAccessState}
                  expectsPromotion={flow.expectsPromotion}
                  promotionActive={flow.promotionActive}
                  promotionEndsAt={flow.promotionEndsAt}
                  authCallbackStatus={authCallbackStatus}
                  devAuthSkipEnabled={DEV_ONBOARDING_AUTH_SKIP_ENABLED}
                  onSkipAuthForDev={flow.skipAccountForDev}
                  onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
                  onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
                  onStartCloudTrialWithWebsite={onStartCloudTrialWithWebsite}
                  onDeleteAnonymousAccount={onDeleteAnonymousAccount}
                />
              ) : null}
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

        {footerError ? (
          <p className="dc-onb-footer-status dc-onb-footer-status--error" role="alert">
            {footerError}
          </p>
        ) : (
          <p className="dc-onb-footer-status" aria-live="polite">{footerHint}</p>
        )}
        {showFooter ? (
          <div className="onb-actions dc-onb-actions">
            {flow.step === "welcome" ? <OnboardingLanguageToggle /> : null}
            {showBack ? (
              <button
                type="button"
                className="onb-actions__back dc-onb-back"
                onClick={flow.goToPreviousStep}
                disabled={flow.isCompleting}
              >
                {t("common.back")}
              </button>
            ) : null}
            {showDots ? (
              <div className="onb-actions__dots dc-onb-dots" aria-hidden="true">
                {flow.steps.map((stepDef, index) => (
                  <span
                    key={stepDef.id}
                    className={`onb-actions__dot dc-onb-dot${index === flow.stepIndex ? " onb-actions__dot--active dc-onb-dot--active" : ""}`}
                  />
                ))}
              </div>
            ) : null}
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
        ) : null}
      </form>
    </>
  );
}
