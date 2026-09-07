import { useRef, useState } from "react";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import type { OnboardingFlow } from "./useOnboardingFlow";
import { WelcomeStep } from "./components/steps/WelcomeStep";
import { AccountStep } from "./components/steps/AccountStep";
import { JobStep } from "./components/steps/JobStep";
import { PermissionsStep } from "./components/steps/PermissionsStep";
import { NudgesStep } from "./components/steps/NudgesStep";
import type { DriftIntervention } from "./components/steps/NudgesStep";
import { SetupChoiceStep } from "./components/steps/SetupChoiceStep";
import { ConnectServerStep } from "./components/steps/ConnectServerStep";
import { TestConnectionStep } from "./components/steps/TestConnectionStep";
import { SelfDataReviewStep } from "./components/steps/SelfDataReviewStep";
import { ReadyStep } from "./components/steps/ReadyStep";
import { OnboardingLanguageToggle } from "./components/OnboardingLanguageToggle";
import { useLocalization } from "../localization/LocalizationContext";
import { DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../appFeatureSwitches";
import { ModalPresence } from "../../components/ModalPresence";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";

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
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const title = flow.title;
  const showTitle = flow.step !== "welcome" && flow.step !== "account";
  const showFooter = flow.step !== "account";
  const showDots = flow.step !== "welcome" && flow.step !== "account";
  const showBack = flow.stepIndex > 0;
  const footerLabel = flow.isCompleting
    ? t("onboarding.action.finishing")
    : flow.footerLabel;
  const selectedActivities = flow.mainActivities;

  const advancedVisible = advancedOpen || flow.isUserManagedProviderSetup;
  const contentClassName = [
    "dc-onb-content",
    flow.step === "account" ? "dc-onb-content--account" : "",
    flow.step === "welcome" ? "dc-onb-content--welcome" : "",
    flow.step === "nudges" ? "dc-onb-content--nudges" : "",
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

  function handleInterventionChange(next: DriftIntervention) {
    if (next === "off") {
      flow.setDriftAlarmEnabled(false);
      flow.setExtremeNudgeEnabled(false);
      return;
    }
    if (next === "alert") {
      flow.setDriftAlarmEnabled(true);
      flow.setExtremeNudgeEnabled(false);
      return;
    }
    if (!flow.extremeNudgeEnabled) setConfirmCloseOpen(true);
  }

  function handleConfirmClose() {
    flow.setDriftAlarmEnabled(true);
    flow.setExtremeNudgeEnabled(true);
    setConfirmCloseOpen(false);
  }

  return (
    <>
      <form
        className="onboarding-card dc-onb-card"
        onSubmit={flow.handleSubmit}
        aria-busy={flow.isCompleting}
      >
        <div className="dc-onb-scroll">
          <div className={contentClassName}>
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
              {flow.step === "nudges" ? (
                <NudgesStep
                  driftAlarmEnabled={flow.driftAlarmEnabled}
                  extremeNudgeEnabled={flow.extremeNudgeEnabled}
                  petModeEnabled={flow.petModeEnabled}
                  onInterventionChange={handleInterventionChange}
                  onPetToggle={() => flow.setPetModeEnabled((enabled) => !enabled)}
                />
              ) : null}
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

              {flow.storageError ? (
                <p className="dc-onb-error" role="alert">
                  {flow.storageError}
                </p>
              ) : null}
              {flow.setupError ? (
                <p className="dc-onb-error" role="alert">
                  {flow.setupError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

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
            {flow.step === "permissions" && flow.blockedHint ? <p className="dc-onb-hint">{flow.blockedHint}</p> : null}
            <button
              type="submit"
              className="onb-button onb-button--primary dc-onb-primary"
              disabled={!flow.canAdvance || flow.isCompleting}
            >
              {footerLabel}
            </button>
          </div>
        ) : null}
      </form>

      <ModalPresence>
        {confirmCloseOpen ? (
          <ExtremeConfirmDialog
            onCancel={() => setConfirmCloseOpen(false)}
            onConfirm={handleConfirmClose}
          />
        ) : null}
      </ModalPresence>
    </>
  );
}

function ExtremeConfirmDialog({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".dc-onb-confirm__secondary" });
  useModalDismiss(onCancel);

  return (
    <div className="dc-onb-confirm-backdrop">
      <section
        ref={dialogRef}
        className="dc-onb-confirm modal-shell"
        data-modal-variant="expressive"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dc-onb-confirm-title"
        aria-describedby="dc-onb-confirm-description"
      >
        <div className="dc-onb-confirm__icon" aria-hidden="true">
          <ScissorsIcon />
        </div>
        <div className="dc-onb-confirm__eyebrow">{t("onboarding.nudges.extreme")}</div>
        <h2 id="dc-onb-confirm-title">{t("onboarding.extreme.title")}</h2>
        <p id="dc-onb-confirm-description">{t("onboarding.extreme.description")}</p>
        <div className="dc-onb-confirm__actions">
          <button type="button" className="dc-onb-confirm__secondary" onClick={onCancel}>{t("onboarding.extreme.keepOff")}</button>
          <button type="button" className="dc-onb-confirm__primary" onClick={onConfirm}>{t("onboarding.extreme.allowClosing")}</button>
        </div>
      </section>
    </div>
  );
}

function ScissorsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.25" cy="6.25" r="2.65" />
      <circle cx="6.25" cy="17.75" r="2.65" />
      <path d="M8.2 8.2 19 19M8.2 15.8 19 5M12.2 12h4.2" />
    </svg>
  );
}
