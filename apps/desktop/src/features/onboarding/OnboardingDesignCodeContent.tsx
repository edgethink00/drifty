import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import { managedLocalAiProgressText } from "../settings/managedLocalAiProgressText";
import driftyIconUrl from "../../assets/drifty-icon.png";
import { GoogleMark } from "./components/GoogleMark";
import { BrowserHistoryBootstrapPreference } from "./components/BrowserHistoryBootstrapPreference";
import { MAIN_ACTIVITY_OPTIONS, MAX_MAIN_ACTIVITY_SELECTIONS, WORK_DOMAIN_OPTIONS } from "./constants";
import type { SetupChoice } from "./onboardingFlow";
import type { OnboardingFlow } from "./useOnboardingFlow";

const DEFAULT_LOCAL_MODEL_ID = "drifty-qwen3-5-4b-default";
const TRIAL_DAYS = 7;

type OnboardingDesignCodeContentProps = {
  readonly flow: OnboardingFlow;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
};

type SetupCardProps = {
  readonly badge?: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly selected: boolean;
  readonly onClick: () => void;
};

type ToggleButtonProps = {
  readonly label: string;
  readonly on: boolean;
  readonly tone?: "default" | "extreme";
  readonly compact?: boolean;
  readonly onClick: () => void;
};

export function OnboardingDesignCodeContent({
  flow,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: OnboardingDesignCodeContentProps) {
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

  const title = titleForDesignCodeStep(flow);
  const showTitle = flow.step !== "welcome" && flow.step !== "account";
  const showFooter = flow.step !== "account";
  const showDots = flow.step !== "welcome" && flow.step !== "account";
  const showBack = flow.stepIndex > 0;
  const footerLabel = footerLabelForDesignCodeStep(flow);
  const selectedActivities = flow.mainActivities;
  const activityOptions = useMemo(() => {
    const query = activityQuery.trim().toLowerCase();
    return MAIN_ACTIVITY_OPTIONS.filter((option) => (
      !selectedActivities.includes(option) && (!query || option.toLowerCase().includes(query))
    ));
  }, [activityQuery, selectedActivities]);
  const activityQueryTrimmed = activityQuery.trim();
  const showActivityCustom = activityQueryTrimmed.length > 0
    && !MAIN_ACTIVITY_OPTIONS.some((option) => option.toLowerCase() === activityQueryTrimmed.toLowerCase())
    && !selectedActivities.some((option) => option.toLowerCase() === activityQueryTrimmed.toLowerCase())
    && selectedActivities.length < MAX_MAIN_ACTIVITY_SELECTIONS;
  const domainOptions = useMemo(() => {
    const query = domainQuery.trim().toLowerCase();
    return WORK_DOMAIN_OPTIONS.filter((option) => !query || option.toLowerCase().includes(query));
  }, [domainQuery]);
  const domainQueryTrimmed = domainQuery.trim();
  const showDomainCustom = domainQueryTrimmed.length > 0
    && !WORK_DOMAIN_OPTIONS.some((option) => option.toLowerCase() === domainQueryTrimmed.toLowerCase());

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
    setDomainQuery(option);
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
              <p className="dc-onb-subtitle">Pick how Drifty runs its AI. You can change this any time.</p>
            ) : null}

            <div className="onboarding-step dc-onb-step" key={flow.step} ref={flow.stepBodyRef}>
              {flow.step === "welcome" ? <WelcomeStep /> : null}
              {flow.step === "account" ? (
                <AccountStep
                  accountConnected={flow.accountConnected}
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
                  flow={flow}
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
                Back
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

function WelcomeStep() {
  return (
    <div className="dc-onb-welcome">
      <img className="dc-onb-welcome__icon" src={driftyIconUrl} alt="" aria-hidden="true" />
      <span className="dc-onb-welcome__headline">Welcome to drifty.</span>
      <span className="dc-onb-welcome__headline dc-onb-welcome__headline--muted">Your AI time tracker.</span>
      <span className="dc-onb-welcome__body">
        I show where your time actually goes, and gently help you stay with the work that matters.
      </span>
    </div>
  );
}

function AccountStep({
  accountConnected,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: {
  readonly accountConnected: boolean;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
}) {
  return (
    <div className="dc-onb-account">
      <h2 className="dc-onb-account__title">Connect your account</h2>
      <p className="dc-onb-account__copy">
        Your account keeps focus and drift insights synced across your devices.
      </p>
      <div className="dc-onb-account__buttons">
        <button
          type="button"
          className="dc-onb-account__google"
          onClick={onStartCloudTrialWithGoogle}
          disabled={accountConnected}
        >
          {accountConnected ? (
            <span>Account connected</span>
          ) : (
            <>
              <GoogleMark />
              <span>Continue with Google</span>
            </>
          )}
        </button>
        <div className="dc-onb-divider" aria-hidden="true">
          <span />
          or
          <span />
        </div>
        <button
          type="button"
          className="dc-onb-account__email"
          onClick={onStartCloudTrialWithEmail}
          disabled={accountConnected}
        >
          {accountConnected ? "Signed in" : "Continue with email"}
        </button>
      </div>
      <p className="dc-onb-account__helper">
        Drifty never shares your activity data with teammates unless you choose to join a team or share a report.
      </p>
      <p className="dc-onb-account__legal">
        By continuing, you accept{" "}
        <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">Terms</a>{" "}
        &amp; <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">Privacy</a>.
      </p>
    </div>
  );
}

function JobStep({
  activityOpen,
  activityOptions,
  activityQuery,
  domainOpen,
  domainOptions,
  domainQuery,
  flow,
  selectedActivities,
  showActivityCustom,
  showDomainCustom,
  onActivityFocus,
  onActivityInput,
  onActivityKeyDown,
  onAddActivity,
  onDomainFocus,
  onDomainInput,
  onDomainKeyDown,
  onRemoveActivity,
  onSelectDomain,
  activityDropdownStyle,
  activityInputRef,
  domainDropdownStyle,
  domainInputRef,
}: {
  readonly activityDropdownStyle?: CSSProperties;
  readonly activityInputRef: RefObject<HTMLInputElement>;
  readonly activityOpen: boolean;
  readonly activityOptions: readonly string[];
  readonly activityQuery: string;
  readonly domainDropdownStyle?: CSSProperties;
  readonly domainInputRef: RefObject<HTMLInputElement>;
  readonly domainOpen: boolean;
  readonly domainOptions: readonly string[];
  readonly domainQuery: string;
  readonly flow: OnboardingFlow;
  readonly selectedActivities: readonly string[];
  readonly showActivityCustom: boolean;
  readonly showDomainCustom: boolean;
  readonly onActivityFocus: () => void;
  readonly onActivityInput: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onActivityKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onAddActivity: (option: string) => void;
  readonly onDomainFocus: () => void;
  readonly onDomainInput: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDomainKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onRemoveActivity: (option: string) => void;
  readonly onSelectDomain: (option: string) => void;
}) {
  const activityQueryTrimmed = activityQuery.trim();
  const domainQueryTrimmed = domainQuery.trim();
  const activityPlaceholder = selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS
    ? "Maximum 5 selected"
    : selectedActivities.length > 0
      ? "Add another…"
      : "Type to search or add your own…";

  return (
    <div className="dc-onb-job">
      <div className="dc-onb-field-group">
        <div className="dc-onb-field-head">
          <h2 className="dc-onb-field-label">What do you usually work on?</h2>
          <span className="dc-onb-count">{selectedActivities.length} / {MAX_MAIN_ACTIVITY_SELECTIONS}</span>
        </div>
        <div className="dc-onb-combobox" data-onb-combobox>
          {selectedActivities.length > 0 ? (
            <div className="dc-onb-tags" role="group" aria-label="Selected activities">
              {selectedActivities.map((activity) => (
                <button
                  type="button"
                  className="dc-onb-tag"
                  key={activity}
                  onClick={() => onRemoveActivity(activity)}
                  aria-label={`Remove ${activity}`}
                >
                  <span>{activity}</span>
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="dc-onb-combobox__anchor">
            <input
              className="dc-onb-input"
              value={activityQuery}
              onChange={onActivityInput}
              onFocus={onActivityFocus}
              onKeyDown={onActivityKeyDown}
              placeholder={activityPlaceholder}
              disabled={selectedActivities.length >= MAX_MAIN_ACTIVITY_SELECTIONS}
              aria-label="Search activities"
              ref={activityInputRef}
            />
            {activityOpen ? (
              <DropdownList style={activityDropdownStyle}>
                {activityOptions.map((option) => (
                  <DropdownOption key={option} onClick={() => onAddActivity(option)}>
                    {option}
                  </DropdownOption>
                ))}
                {showActivityCustom ? (
                  <DropdownOption onClick={() => onAddActivity(activityQueryTrimmed)}>
                    <span className="dc-onb-add-icon" aria-hidden="true">+</span>
                    Add "{activityQueryTrimmed}"
                  </DropdownOption>
                ) : null}
                {activityOptions.length === 0 && !showActivityCustom ? (
                  <div className="dc-onb-dropdown-empty">No matches — keep typing to add your own.</div>
                ) : null}
              </DropdownList>
            ) : null}
          </div>
        </div>
      </div>

      <div className="dc-onb-field-group">
        <h2 className="dc-onb-field-label">What field are you in?</h2>
        <div className="dc-onb-combobox__anchor" data-onb-combobox>
          <input
            className="dc-onb-input"
            value={domainQuery}
            onChange={onDomainInput}
            onFocus={onDomainFocus}
            onKeyDown={onDomainKeyDown}
            placeholder="Type to search or add your own…"
            aria-label="Your field"
            ref={domainInputRef}
          />
          {domainOpen ? (
            <DropdownList style={domainDropdownStyle}>
              {domainOptions.map((option) => (
                <DropdownOption key={option} onClick={() => onSelectDomain(option)}>
                  {option}
                </DropdownOption>
              ))}
              {showDomainCustom ? (
                <DropdownOption onClick={() => onSelectDomain(domainQueryTrimmed)}>
                  <span className="dc-onb-add-icon" aria-hidden="true">+</span>
                  Add "{domainQueryTrimmed}"
                </DropdownOption>
              ) : null}
            </DropdownList>
          ) : null}
        </div>
      </div>

      <div className="dc-onb-job-hint">
        <InfoIcon />
        <p>
          Drifty's AI uses these as hints to <strong>auto-sort your time</strong> into the right categories — so your
          timeline reads like your real work, not a list of raw app names. You can edit or add more later.
        </p>
      </div>
    </div>
  );
}

function DropdownList({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) {
  return <div className="dc-onb-dropdown" style={style}>{children}</div>;
}

function DropdownOption({
  children,
  onClick,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="dc-onb-dropdown-option" onClick={onClick}>
      {children}
    </button>
  );
}

function PermissionsStep({ flow }: { readonly flow: OnboardingFlow }) {
  const accessibilityEnabled = flow.accessibilityGranted;
  const notificationsEnabled = flow.notificationsReady;

  return (
    <>
      <p className="dc-onb-copy">
        Drifty needs a couple of Mac permissions to see your focus and drift patterns. Everything is processed for your own timeline.
      </p>
      <ul className="dc-onb-row-list">
        <PermissionRow
          title="Accessibility"
          description="Lets Drifty see your active app and window — required to track at all."
          pill={accessibilityEnabled ? "Enabled" : "Required"}
          tone={accessibilityEnabled ? "success" : "required"}
          disabled={accessibilityEnabled}
          onClick={() => void flow.handleRequestAccessibilityClick()}
        />
        <PermissionRow
          title="Notifications"
          description="Lets Drifty send gentle focus nudges and setup alerts."
          pill={notificationsEnabled ? "Enabled" : "Recommended"}
          tone={notificationsEnabled ? "success" : "neutral"}
          disabled={notificationsEnabled}
          onClick={() => void flow.handleNotificationPermissionClick()}
        />
      </ul>
    </>
  );
}

function PermissionRow({
  description,
  disabled,
  onClick,
  pill,
  title,
  tone,
}: {
  readonly description: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly pill: string;
  readonly title: string;
  readonly tone: "success" | "required" | "neutral";
}) {
  return (
    <li className="dc-onb-row">
      <div className="dc-onb-row__copy">
        <span className="dc-onb-row__title">{title}</span>
        <span className="dc-onb-row__desc">{description}</span>
      </div>
      <div className="dc-onb-row__action">
        <span className={`dc-onb-pill dc-onb-pill--${tone}`}>{pill}</span>
        <button type="button" className="dc-onb-secondary-button" onClick={onClick} disabled={disabled}>
          {disabled ? "Enabled" : "Enable"}
        </button>
      </div>
    </li>
  );
}

function NudgesStep({
  driftAlarmEnabled,
  extremeNudgeEnabled,
  onDriftToggle,
  onExtremeToggle,
}: {
  readonly driftAlarmEnabled: boolean;
  readonly extremeNudgeEnabled: boolean;
  readonly onDriftToggle: () => void;
  readonly onExtremeToggle: () => void;
}) {
  return (
    <>
      <p className="dc-onb-copy">
        Choose how firmly Drifty pulls you back when you drift. You can change this any time.
      </p>
      <ul className="dc-onb-row-list">
        <li className="dc-onb-row">
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title">Drift alarm</span>
            <span className="dc-onb-row__desc">A gentle alert after you've drifted for a while.</span>
          </div>
          <ToggleButton label="Drift alarm" on={driftAlarmEnabled} onClick={onDriftToggle} />
        </li>
        <li className={`dc-onb-row${extremeNudgeEnabled ? " dc-onb-row--extreme-on" : ""}`}>
          <div className="dc-onb-row__copy">
            <span className="dc-onb-row__title dc-onb-row__title--with-badge">
              Extreme nudge <span className="dc-onb-beta">Beta</span>
            </span>
            <span className="dc-onb-row__desc">Closes the distracting tab or app when repeated drift is detected.</span>
          </div>
          <ToggleButton label="Extreme nudge" on={extremeNudgeEnabled} tone="extreme" onClick={onExtremeToggle} />
        </li>
      </ul>
    </>
  );
}

function SetupChoiceStep({
  advancedVisible,
  flow,
  onToggleAdvanced,
}: {
  readonly advancedVisible: boolean;
  readonly flow: OnboardingFlow;
  readonly onToggleAdvanced: () => void;
}) {
  return (
    <div className="dc-onb-setup">
      <SetupCard
        badge="Recommended"
        description={`We host the AI for you — nothing to install. Includes a ${TRIAL_DAYS}-day free trial.`}
        icon={<CloudIcon />}
        label="Drifty Cloud"
        selected={flow.setupChoice === "simple"}
        onClick={() => flow.handleSetupChoice("simple")}
      />
      <SetupCard
        description="Runs on this Mac — your activity never leaves your device. One-time model download."
        icon={<LocalIcon />}
        label="Local AI"
        selected={flow.setupChoice === "local_ai"}
        onClick={() => flow.handleSetupChoice("local_ai")}
      />
      <button
        type="button"
        className="dc-onb-advanced-toggle"
        onClick={onToggleAdvanced}
        aria-expanded={advancedVisible}
      >
        <ChevronIcon rotated={advancedVisible} />
        Connect your own AI provider
      </button>
      {advancedVisible ? (
        <div className="dc-onb-advanced-cards">
          <SetupCard
            description="Use your own OpenRouter API key. Roughly $2-4/month, depending on usage."
            icon={<KeyIcon />}
            label="Bring your own key"
            selected={flow.setupChoice === "byok"}
            onClick={() => flow.handleSetupChoice("byok")}
          />
          <SetupCard
            description="Point Drifty at any OpenAI-compatible endpoint and model you run."
            icon={<CustomEndpointIcon />}
            label="Custom endpoint"
            selected={flow.setupChoice === "custom_endpoint"}
            onClick={() => flow.handleSetupChoice("custom_endpoint")}
          />
        </div>
      ) : null}
    </div>
  );
}

function SetupCard({ badge, description, icon, label, selected, onClick }: SetupCardProps) {
  return (
    <button
      type="button"
      className={`dc-onb-setup-card${selected ? " dc-onb-setup-card--selected" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="dc-onb-setup-card__icon" aria-hidden="true">{icon}</span>
      <span className="dc-onb-setup-card__copy">
        <span className="dc-onb-setup-card__title-line">
          <span className="dc-onb-setup-card__title">{label}</span>
          {badge ? <span className="dc-onb-setup-card__badge">{badge}</span> : null}
        </span>
        <span className="dc-onb-setup-card__desc">{description}</span>
      </span>
      {selected ? <CheckCircleIcon className="dc-onb-setup-card__check" /> : null}
    </button>
  );
}

function ConnectServerStep({ flow }: { readonly flow: OnboardingFlow }) {
  return (
    <>
      <p className="dc-onb-copy dc-onb-server-copy">{serverDescriptionForSetup(flow.setupChoice)}</p>
      {flow.setupChoice === "local_ai" ? <LocalAiSetup flow={flow} /> : null}
      {flow.isCustomEndpointSetup ? <CustomEndpointSetup flow={flow} /> : null}
      {flow.isByokSetup ? <ByokSetup flow={flow} /> : null}
    </>
  );
}

function LocalAiSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const status = flow.managedLocalAi.status;
  const selectedModelId = flow.managedLocalAi.status?.selectedModelId
    ?? flow.managedLocalAi.actionModelId
    ?? DEFAULT_LOCAL_MODEL_ID;
  const statusBusy = (flow.managedLocalAi.loading && status === null)
    || (Boolean(flow.managedLocalAi.actionModelId) && status?.state !== "error")
    || status?.state === "installing"
    || status?.state === "starting";
  const statusMessage = localModelStatusMessage(flow.managedLocalAi.loading, status);

  return (
    <div className="dc-onb-local">
      <div className="dc-onb-status" role="status">
        {statusBusy ? <SpinnerIcon /> : null}
        {statusMessage}
      </div>
      <div className="dc-onb-local__cards">
        {flow.managedLocalAi.catalog.map((model) => (
          <LocalModelCard
            key={model.id}
            model={model}
            selected={selectedModelId === model.id}
            flow={flow}
          />
        ))}
      </div>
    </div>
  );
}

function LocalModelCard({
  flow,
  model,
  selected,
}: {
  readonly flow: OnboardingFlow;
  readonly model: ManagedLocalAiModel;
  readonly selected: boolean;
}) {
  const status = flow.managedLocalAi.status;
  const installingThisModel = flow.managedLocalAi.actionModelId === model.id
    || (status?.state === "installing" && status.selectedModelId === model.id);
  const failedThisModel = status?.state === "error" && status.selectedModelId === model.id;
  const ready = localModelIsReady(model.id, status);
  const disabled = ready
    || (flow.managedLocalAi.loading && status === null)
    || Boolean(flow.managedLocalAi.actionModelId)
    || status?.state === "installing"
    || status?.state === "starting";
  const actionLabel = localModelActionLabel({
    failed: failedThisModel,
    installing: installingThisModel,
    progress: installingThisModel ? status?.progress ?? null : null,
    ready,
  });
  const description = localModelDescription({
    defaultDescription: model.detail,
    failed: failedThisModel,
    installing: installingThisModel,
    ready,
    status,
  });

  return (
    <article
      className={`dc-onb-local-card${selected ? " dc-onb-local-card--selected" : ""}`}
      aria-label={`${model.label} local AI model`}
    >
      <div className="dc-onb-local-card__copy">
        <div className="dc-onb-local-card__title-line">
          <strong>{model.label}</strong>
          <span className={model.recommended ? "dc-onb-local-card__tier dc-onb-local-card__tier--recommended" : "dc-onb-local-card__tier"}>
            {model.recommended ? "Recommended" : titleCase(model.tier)}
          </span>
        </div>
        <p>{description}</p>
      </div>
      <dl className="dc-onb-local-card__meta">
        <div>
          <dt>Download</dt>
          <dd>{model.downloadSize}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{model.minimumMemory}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="dc-onb-secondary-button"
        disabled={disabled}
        onClick={() => void flow.managedLocalAi.installModel(model.id)}
      >
        {actionLabel}
      </button>
    </article>
  );
}

function localModelStatusMessage(loading: boolean, status: ManagedLocalAiStatus | null): string {
  const progressText = managedLocalAiProgressText(status?.progress ?? null);
  if (status?.progress && progressText) return `Downloading ${status.progress.percent.toFixed(0)}% · ${progressText}`;
  if (status) return status.message;
  return loading ? "Looking for downloaded local models..." : "Choose a local model and Drifty will download it inside the app.";
}

function localModelIsReady(modelId: string, status: ManagedLocalAiStatus | null): boolean {
  if (status?.selectedModelId !== modelId) return false;
  return status.state === "installed" || status.state === "starting" || status.state === "running";
}

function localModelActionLabel({
  failed,
  installing,
  progress,
  ready,
}: {
  readonly failed: boolean;
  readonly installing: boolean;
  readonly progress: ManagedLocalAiStatus["progress"];
  readonly ready: boolean;
}): string {
  if (ready) return "Ready";
  if (failed) return "Retry";
  if (installing) return progress === null ? "Downloading..." : `Downloading ${progress.percent.toFixed(0)}%`;
  return "Download";
}

function localModelDescription({
  defaultDescription,
  failed,
  installing,
  ready,
  status,
}: {
  readonly defaultDescription: string;
  readonly failed: boolean;
  readonly installing: boolean;
  readonly ready: boolean;
  readonly status: ManagedLocalAiStatus | null;
}): string {
  if (ready) return "Ready for private local classification.";
  if ((installing || failed) && status?.message) return status.message;
  return defaultDescription;
}

function CustomEndpointSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const baseIssue = flow.customEndpointDraft.baseUrl.trim() ? flow.customEndpointBaseUrlIssue : null;
  const modelIssue = flow.customEndpointDraft.model.trim() ? flow.customEndpointModelIssue : null;

  return (
    <div className="dc-onb-server-form">
      <label className="dc-onb-labeled-input">
        <span>Base URL</span>
        <input
          className={baseIssue ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          value={flow.customEndpointDraft.baseUrl}
          onChange={(event) => flow.handleCustomEndpointDraftChange({ ...flow.customEndpointDraft, baseUrl: event.target.value })}
          placeholder="http://localhost:11434/v1"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={baseIssue ? "true" : "false"}
          aria-label="Custom endpoint base URL"
        />
        <span className={baseIssue ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {baseIssue ?? "Use an OpenAI-compatible /v1 endpoint. Localhost works."}
        </span>
      </label>
      <label className="dc-onb-labeled-input">
        <span>Model</span>
        <input
          className={modelIssue ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          value={flow.customEndpointDraft.model}
          onChange={(event) => flow.handleCustomEndpointDraftChange({ ...flow.customEndpointDraft, model: event.target.value })}
          placeholder="llama3.2:latest"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={modelIssue ? "true" : "false"}
          aria-label="Custom endpoint model"
        />
        <span className={modelIssue ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {modelIssue ?? "Enter the model id your endpoint exposes."}
        </span>
      </label>
    </div>
  );
}

function ByokSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const apiInvalid = flow.apiKey.trim().length > 0 && !flow.apiKeyIsValid;

  return (
    <div className="dc-onb-server-form dc-onb-server-form--compact">
      <label className="dc-onb-labeled-input">
        <span>OpenRouter API key</span>
        <input
          className={apiInvalid ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          type="password"
          value={flow.apiKey}
          onChange={(event) => flow.handleApiKeyChange(event.target.value)}
          placeholder="sk-or-..."
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={apiInvalid ? "true" : "false"}
          aria-label="OpenRouter API key"
        />
        <span className={apiInvalid ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {apiInvalid ? "OpenRouter key should start with sk-or-." : "Drifty never displays the raw key after you leave this field."}
        </span>
      </label>
    </div>
  );
}

function TestConnectionStep({ flow }: { readonly flow: OnboardingFlow }) {
  return (
    <>
      <p className="dc-onb-copy">
        {flow.connectionPhase === "success"
          ? flow.isByokSetup
            ? "Your OpenRouter key is connected and ready for AI classification."
            : "Your custom endpoint is connected and ready for AI classification."
          : flow.isByokSetup
            ? "Checking that Drifty can use your masked OpenRouter key."
            : "Checking that Drifty can use your custom endpoint."}
      </p>
      <ul className="dc-onb-check-list">
        {flow.connectionChecks.map((check, index) => {
          const status = flow.checkStatuses[index] ?? "pending";
          return (
            <li className="dc-onb-check-row" key={check.id}>
              <span className="dc-onb-check-row__mark" aria-hidden="true">
                {status === "success" ? <SuccessIcon /> : status === "loading" ? <SpinnerIcon /> : <PendingIcon failed={status === "error"} />}
              </span>
              <span className={status === "success" ? "dc-onb-check-row__label" : "dc-onb-check-row__label dc-onb-check-row__label--pending"}>
                {check.label}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SelfDataReviewStep({ flow }: { readonly flow: OnboardingFlow }) {
  const maskedApiKey = flow.maskedApiKey?.replace("••••••", "......") ?? null;
  const isByok = flow.isByokSetup;
  const isCustom = flow.isCustomEndpointSetup;
  const reviewIntro = isByok
    ? "With BYOK, Drifty sends minimized activity context to your chosen provider through OpenRouter using your masked key."
    : isCustom
      ? "With a custom endpoint, Drifty sends minimized activity context to the endpoint and model you entered."
      : "With Local AI, minimized activity context stays on this Mac and is classified by the model you picked.";
  const whereDesc = isByok
    ? "Minimized classification context goes to OpenRouter for the model call."
    : isCustom
      ? "Minimized classification context goes to your custom endpoint for the model call."
      : "Activity goes to the selected local model on this Mac, not to Drifty Cloud.";
  const whoDesc = isByok
    ? "You manage the provider key, model access, and provider billing."
    : isCustom
      ? "You manage the endpoint, model access, uptime, and billing if it is hosted."
      : "Drifty manages the local runtime files; you control whether the model is installed.";
  const whatDesc = isByok
    ? `A masked OpenRouter key${maskedApiKey ? ` (${maskedApiKey})` : ""} plus local permissions for activity context.`
    : isCustom
      ? `Local permissions plus ${flow.customEndpointDraft.model.trim() || "your model"} at ${flow.customEndpointDraft.baseUrl.trim()}.`
      : "Local permissions to read activity context and a downloaded managed local model.";

  return (
    <>
      <p className="dc-onb-copy dc-onb-copy--wide">{reviewIntro}</p>
      <div className="dc-onb-data-grid">
        <DataCard title="Where data goes" description={whereDesc} />
        <DataCard title="Who manages it" description={whoDesc} />
        <DataCard title="What Drifty needs" description={whatDesc} />
      </div>
      <p className="dc-onb-muted-note">You can change these settings later.</p>
    </>
  );
}

function DataCard({ description, title }: { readonly description: string; readonly title: string }) {
  return (
    <div className="dc-onb-data-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const summaryItems = summaryItemsForFlow(flow);

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">
        Drifty will now track your focus and drift in the background while you work.
      </p>
      <ul className="dc-onb-ready-list">
        {summaryItems.map((item, index) => (
          <li className="dc-onb-ready-item" key={item.label}>
            <CheckMarkIcon />
            {item.sub ? (
              <span className="dc-onb-ready-item__stack">
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
              </span>
            ) : (
              <span className="dc-onb-ready-item__label">{item.label}</span>
            )}
            {index === 0 ? null : <span className="dc-onb-ready-item__divider" aria-hidden="true" />}
          </li>
        ))}
      </ul>
      <div className="dc-onb-login-row">
        <h2>Start Drifty at login</h2>
        <ToggleButton
          label="Start Drifty at login"
          on={flow.openAtLoginEnabled}
          compact
          onClick={() => flow.setOpenAtLoginEnabled((current) => !current)}
        />
      </div>
      <BrowserHistoryBootstrapPreference
        enabled={flow.browserHistoryBootstrapEnabled}
        onChange={flow.setBrowserHistoryBootstrapEnabled}
      />
      <p className="dc-onb-muted-note dc-onb-muted-note--ready">You can pause Drifty any time from the menu bar.</p>
    </>
  );
}

function ToggleButton({ compact = false, label, on, onClick, tone = "default" }: ToggleButtonProps) {
  return (
    <button
      type="button"
      className={`dc-onb-toggle${compact ? " dc-onb-toggle--compact" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      <span className={`dc-onb-toggle__track${on ? ` dc-onb-toggle__track--on dc-onb-toggle__track--${tone}` : ""}`}>
        <span className="dc-onb-toggle__thumb" />
      </span>
      <span className="dc-onb-toggle__label">{on ? "On" : "Off"}</span>
    </button>
  );
}

function ExtremeConfirmDialog({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="dc-onb-confirm-backdrop">
      <section className="dc-onb-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dc-onb-confirm-title">
        <div className="dc-onb-confirm__icon" aria-hidden="true">
          <ScissorsIcon />
        </div>
        <div className="dc-onb-confirm__eyebrow">Extreme nudge</div>
        <h2 id="dc-onb-confirm-title">Let Drifty close drift?</h2>
        <p>
          When repeated drift is detected, Drifty can close the distracting browser tab or quit the distracting app.
          This is more direct than a warning.
        </p>
        <div className="dc-onb-confirm__actions">
          <button type="button" className="dc-onb-confirm__secondary" onClick={onCancel}>Keep off</button>
          <button type="button" className="dc-onb-confirm__primary" onClick={onConfirm}>Allow closing</button>
        </div>
      </section>
    </div>
  );
}

function titleForDesignCodeStep(flow: OnboardingFlow): string {
  switch (flow.step) {
    case "welcome":
      return "Welcome to drifty";
    case "job":
      return "What do you usually do?";
    case "permissions":
      return "Set up permissions";
    case "nudges":
      return "Set up drift alerts";
    case "choose_setup":
      return "Choose your setup";
    case "account":
      return "Connect your account";
    case "connect_server":
      if (flow.isByokSetup) return "Add your OpenRouter key";
      if (flow.isCustomEndpointSetup) return "Add your custom endpoint";
      return "Set up your local AI model";
    case "test_connection":
      if (flow.connectionPhase === "success") return "Connection successful";
      if (flow.connectionPhase === "failed") return "Connection failed";
      return "Testing connection";
    case "self_data_review":
      return "How your data is handled";
    case "ready":
      return flow.setupChoice === "simple" && flow.accountConnected ? "You're ready to go" : "You're ready to start";
    case "data_review":
    case "privacy":
    case "work_profile":
    case "accessibility":
    case "notifications":
      return flow.title;
  }
}

function footerLabelForDesignCodeStep(flow: OnboardingFlow): string {
  if (flow.step === "ready") return "Start tracking";
  if (flow.step === "connect_server" && flow.isUserManagedProviderSetup) return "Test connection";
  return "Continue";
}

function serverDescriptionForSetup(setupChoice: SetupChoice | null): string {
  if (setupChoice === "byok") {
    return "Enter the OpenRouter key Drifty uses for focus insights. The key stays masked during setup.";
  }
  if (setupChoice === "custom_endpoint") {
    return "Enter the OpenAI-compatible endpoint and model Drifty should use for minimized classification requests.";
  }
  return "Choose a managed local model. Drifty downloads it inside the app and keeps classification on this Mac.";
}

function summaryItemsForFlow(flow: OnboardingFlow): ReadonlyArray<{ readonly label: string; readonly sub?: string }> {
  if (flow.setupChoice === "local_ai" || flow.isUserManagedProviderSetup) {
    return [
      { label: flow.setupChoice === "local_ai" ? "Local AI selected" : flow.isByokSetup ? "BYOK selected" : "Custom endpoint selected" },
      { label: "Account connected" },
      {
        label: flow.setupChoice === "local_ai"
          ? flow.managedLocalStarted ? "Local model downloading" : "Local model ready"
          : flow.isByokSetup ? "OpenRouter key connected" : "Custom endpoint connected",
      },
      { label: "Tracking ready" },
    ];
  }
  return [
    { label: "Drifty Cloud selected" },
    { label: "Account connected" },
    { label: `${TRIAL_DAYS}-day free trial started`, sub: "Your Drifty Cloud trial is ready." },
    { label: "Tracking ready" },
  ];
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function PendingIcon({ failed }: { readonly failed: boolean }) {
  return <span className={failed ? "dc-onb-pending-dot dc-onb-pending-dot--failed" : "dc-onb-pending-dot"} />;
}

function SpinnerIcon() {
  return <span className="dc-onb-spinner" aria-hidden="true" />;
}

function SuccessIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#1f8a5b" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMarkIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M4 12.5l4.5 4.5L20 6" stroke="#1c1c19" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <span className="dc-onb-job-hint__icon" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 11v5M12 8.2v.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function ChevronIcon({ rotated }: { readonly rotated: boolean }) {
  return (
    <span className={rotated ? "dc-onb-chevron dc-onb-chevron--rotated" : "dc-onb-chevron"} aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path d="M5.25 3.5L8.75 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.2 17.2h9.2a4 4 0 0 0 .4-8 5.8 5.8 0 0 0-11 1.8 3.2 3.2 0 0 0 1.4 6.2Z" />
    </svg>
  );
}

function LocalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6.8" width="12" height="8.4" rx="1.4" />
      <path d="M8.4 18h7.2M9.2 9.8h5.6M9.2 12.2h5.6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.1" cy="15.9" r="2.45" />
      <path d="M9.85 14.15 16.9 7.1M15.35 8.65l1.8 1.8M13.95 10.05l1.25 1.25" />
    </svg>
  );
}

function CustomEndpointIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.4 8.2h7.9a3.8 3.8 0 1 1 0 7.6H9.6M9.6 12h9M9.6 15.8a3.8 3.8 0 1 1 0-7.6h3.7" />
    </svg>
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
