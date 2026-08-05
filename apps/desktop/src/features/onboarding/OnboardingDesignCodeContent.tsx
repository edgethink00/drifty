import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { OAuthCallbackStatus } from "../auth/AuthContext";
import { MAIN_ACTIVITY_OPTIONS, MAX_MAIN_ACTIVITY_SELECTIONS, WORK_DOMAIN_OPTIONS } from "./constants";
import type { OnboardingFlow } from "./useOnboardingFlow";
import { WelcomeStep } from "./components/steps/WelcomeStep";
import { AccountStep } from "./components/steps/AccountStep";
import { JobStep } from "./components/steps/JobStep";
import { PermissionsStep } from "./components/steps/PermissionsStep";
import { NudgesStep } from "./components/steps/NudgesStep";
import { SetupChoiceStep } from "./components/steps/SetupChoiceStep";
import { ConnectServerStep } from "./components/steps/ConnectServerStep";
import { TestConnectionStep } from "./components/steps/TestConnectionStep";
import { SelfDataReviewStep } from "./components/steps/SelfDataReviewStep";
import { ReadyStep } from "./components/steps/ReadyStep";
import { useLocalization } from "../localization/LocalizationContext";
import { onboardingActivityLabel, onboardingDomainLabel } from "./onboardingOptionLabels";
import { DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../appFeatureSwitches";

type OnboardingDesignCodeContentProps = {
  readonly flow: OnboardingFlow;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
};

export function OnboardingDesignCodeContent({
  flow,
  authCallbackStatus,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: OnboardingDesignCodeContentProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [activityQuery, setActivityQuery] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [domainQuery, setDomainQuery] = useState("");
  const [domainOpen, setDomainOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmExtremeOpen, setConfirmExtremeOpen] = useState(false);
  const activityInputRef = useRef<HTMLInputElement | null>(null);
  const domainInputRef = useRef<HTMLInputElement | null>(null);
  const [activityDropdownStyle, setActivityDropdownStyle] = useState<CSSProperties | undefined>();
  const [domainDropdownStyle, setDomainDropdownStyle] = useState<CSSProperties | undefined>();

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-onb-combobox]")) return;
      setActivityOpen(false);
      setDomainOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  const title = flow.title;
  const showTitle = flow.step !== "welcome" && flow.step !== "account";
  const showFooter = flow.step !== "account";
  const showDots = flow.step !== "welcome" && flow.step !== "account";
  const showBack = flow.stepIndex > 0;
  const footerLabel = flow.footerLabel;
  const selectedActivities = flow.mainActivities;
  const activityOptions = useMemo(() => {
    const query = activityQuery.trim().toLowerCase();
    return MAIN_ACTIVITY_OPTIONS.filter((option) => (
      !selectedActivities.includes(option) && (!query || onboardingActivityLabel(option, effectiveLanguage).toLowerCase().includes(query))
    ));
  }, [activityQuery, effectiveLanguage, selectedActivities]);
  const activityQueryTrimmed = activityQuery.trim();
  const showActivityCustom = activityQueryTrimmed.length > 0
    && !MAIN_ACTIVITY_OPTIONS.some((option) => onboardingActivityLabel(option, effectiveLanguage).toLowerCase() === activityQueryTrimmed.toLowerCase())
    && !selectedActivities.some((option) => option.toLowerCase() === activityQueryTrimmed.toLowerCase())
    && selectedActivities.length < MAX_MAIN_ACTIVITY_SELECTIONS;
  const domainOptions = useMemo(() => {
    const query = domainQuery.trim().toLowerCase();
    return WORK_DOMAIN_OPTIONS.filter((option) => !query || onboardingDomainLabel(option, effectiveLanguage).toLowerCase().includes(query));
  }, [domainQuery, effectiveLanguage]);
  const domainQueryTrimmed = domainQuery.trim();
  const showDomainCustom = domainQueryTrimmed.length > 0
    && !WORK_DOMAIN_OPTIONS.some((option) => onboardingDomainLabel(option, effectiveLanguage).toLowerCase() === domainQueryTrimmed.toLowerCase());

  useLayoutEffect(() => {
    if (!activityOpen && !domainOpen) return;

    function updateDropdownLayout() {
      setActivityDropdownStyle(activityOpen ? computeDropdownStyle(activityInputRef.current) : undefined);
      setDomainDropdownStyle(domainOpen ? computeDropdownStyle(domainInputRef.current) : undefined);
    }

    updateDropdownLayout();
    window.addEventListener("resize", updateDropdownLayout);
    window.addEventListener("scroll", updateDropdownLayout, true);
    return () => {
      window.removeEventListener("resize", updateDropdownLayout);
      window.removeEventListener("scroll", updateDropdownLayout, true);
    };
  }, [activityOpen, domainOpen, activityOptions.length, domainOptions.length, showActivityCustom, showDomainCustom]);

  const advancedVisible = advancedOpen || flow.isUserManagedProviderSetup;
  const contentClassName = [
    "dc-onb-content",
    flow.step === "account" ? "dc-onb-content--account" : "",
    flow.step === "welcome" ? "dc-onb-content--welcome" : "",
  ].filter(Boolean).join(" ");

  function addActivity(option: string) {
    flow.addMainActivity(option);
    flow.setWorkType(option);
    setActivityQuery("");
    setActivityOpen(false);
  }

  function removeActivity(option: string) {
    flow.toggleMainActivity(option);
    if (flow.workType === option) {
      flow.setWorkType(null);
    }
  }

  function selectDomain(option: string) {
    flow.setWorkDomain(option);
    flow.setWorkDomainOther("");
    setDomainQuery(onboardingDomainLabel(option, effectiveLanguage));
    setDomainOpen(false);
  }

  function handleActivityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const firstOption = activityOptions[0];
      if (firstOption) {
        addActivity(firstOption);
      } else if (activityQueryTrimmed) {
        addActivity(activityQueryTrimmed);
      }
      return;
    }
    if (event.key === "Escape") {
      setActivityOpen(false);
    }
  }

  function handleDomainKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const firstOption = domainOptions[0];
      if (firstOption) {
        selectDomain(firstOption);
      } else if (domainQueryTrimmed) {
        selectDomain(domainQueryTrimmed);
      }
      return;
    }
    if (event.key === "Escape") {
      setDomainOpen(false);
    }
  }

  function handleDriftToggle() {
    if (flow.driftAlarmEnabled) {
      flow.setDriftAlarmEnabled(false);
      flow.setExtremeNudgeEnabled(false);
      return;
    }
    flow.setDriftAlarmEnabled(true);
  }

  function handleExtremeToggle() {
    if (flow.extremeNudgeEnabled) {
      flow.setExtremeNudgeEnabled(false);
      return;
    }
    setConfirmExtremeOpen(true);
  }

  function handleConfirmExtreme() {
    flow.setDriftAlarmEnabled(true);
    flow.setExtremeNudgeEnabled(true);
    setConfirmExtremeOpen(false);
  }

  return (
    <>
      <form className="onboarding-card dc-onb-card" onSubmit={flow.handleSubmit}>
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
              {flow.step === "welcome" ? <WelcomeStep /> : null}
              {flow.step === "account" ? (
                <AccountStep
                  accountConnected={flow.accountConnected}
                  authCallbackStatus={authCallbackStatus}
                  devAuthSkipEnabled={DEV_ONBOARDING_AUTH_SKIP_ENABLED}
                  onSkipAuthForDev={flow.skipAccountForDev}
                  onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
                  onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
                />
              ) : null}
              {flow.step === "job" ? (
                <JobStep
                  activityOpen={activityOpen}
                  activityOptions={activityOptions}
                  activityQuery={activityQuery}
                  domainOpen={domainOpen}
                  domainOptions={domainOptions}
                  domainQuery={domainQuery}
                  selectedActivities={selectedActivities}
                  showActivityCustom={showActivityCustom}
                  showDomainCustom={showDomainCustom}
                  onActivityFocus={() => {
                    setActivityOpen(true);
                    setDomainOpen(false);
                  }}
                  onActivityInput={(event) => {
                    setActivityQuery(event.target.value);
                    setActivityOpen(true);
                    setDomainOpen(false);
                  }}
                  onActivityKeyDown={handleActivityKeyDown}
                  onAddActivity={addActivity}
                  onDomainFocus={() => {
                    setDomainOpen(true);
                    setActivityOpen(false);
                  }}
                  onDomainInput={(event) => {
                    setDomainQuery(event.target.value);
                    flow.setWorkDomain(null);
                    setDomainOpen(true);
                    setActivityOpen(false);
                  }}
                  onDomainKeyDown={handleDomainKeyDown}
                  onRemoveActivity={removeActivity}
                  onSelectDomain={selectDomain}
                  activityDropdownStyle={activityDropdownStyle}
                  activityInputRef={activityInputRef}
                  domainDropdownStyle={domainDropdownStyle}
                  domainInputRef={domainInputRef}
                />
              ) : null}
              {flow.step === "permissions" ? <PermissionsStep flow={flow} /> : null}
              {flow.step === "nudges" ? (
                <NudgesStep
                  driftAlarmEnabled={flow.driftAlarmEnabled}
                  extremeNudgeEnabled={flow.extremeNudgeEnabled}
                  onDriftToggle={handleDriftToggle}
                  onExtremeToggle={handleExtremeToggle}
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
            {showBack ? (
              <button type="button" className="onb-actions__back dc-onb-back" onClick={flow.goToPreviousStep}>
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
            <button type="submit" className="onb-button onb-button--primary dc-onb-primary" disabled={!flow.canAdvance}>
              {footerLabel}
            </button>
          </div>
        ) : null}
      </form>

      {confirmExtremeOpen ? (
        <ExtremeConfirmDialog onCancel={() => setConfirmExtremeOpen(false)} onConfirm={handleConfirmExtreme} />
      ) : null}
    </>
  );
}

function computeDropdownStyle(input: HTMLInputElement | null): CSSProperties | undefined {
  if (!input) return undefined;
  const rect = input.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const gap = 6;
  const desiredMaxHeight = 236;
  const spaceBelow = viewportHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(96, Math.min(desiredMaxHeight, openUp ? spaceAbove : spaceBelow));

  return {
    position: "fixed",
    left: rect.left,
    right: "auto",
    width: rect.width,
    top: openUp ? "auto" : rect.bottom + gap,
    bottom: openUp ? viewportHeight - rect.top + gap : "auto",
    maxHeight,
    zIndex: 9999,
  };
}

function ExtremeConfirmDialog({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="dc-onb-confirm-backdrop">
      <section className="dc-onb-confirm modal-shell" data-modal-variant="expressive" role="alertdialog" aria-modal="true" aria-labelledby="dc-onb-confirm-title">
        <div className="dc-onb-confirm__icon" aria-hidden="true">
          <ScissorsIcon />
        </div>
        <div className="dc-onb-confirm__eyebrow">{t("onboarding.nudges.extreme")}</div>
        <h2 id="dc-onb-confirm-title">{t("onboarding.extreme.title")}</h2>
        <p>{t("onboarding.extreme.description")}</p>
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
