import { AccountStep } from "./components/AccountStep";
import { NudgesStep } from "./components/NudgesStep";
import { AccessibilityStep } from "./components/steps/AccessibilityStep";
import { ConnectServerStep } from "./components/steps/ConnectServerStep";
import { DataReviewStep } from "./components/steps/DataReviewStep";
import { JobStep } from "./components/steps/JobStep";
import { NotificationsStep } from "./components/steps/NotificationsStep";
import { PermissionsStep } from "./components/steps/PermissionsStep";
import { PrivacyStep } from "./components/steps/PrivacyStep";
import { ReadyStep } from "./components/steps/ReadyStep";
import { SelfDataReviewStep } from "./components/steps/SelfDataReviewStep";
import { SetupChoiceStep } from "./components/steps/SetupChoiceStep";
import { TestConnectionStep } from "./components/steps/TestConnectionStep";
import { WelcomeStep } from "./components/steps/WelcomeStep";
import { WorkProfileStep } from "./components/steps/WorkProfileStep";
import type { OnboardingFlow } from "./useOnboardingFlow";

type OnboardingStepContentProps = {
  readonly flow: OnboardingFlow;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
};

export function OnboardingStepContent({
  flow,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: OnboardingStepContentProps) {
  switch (flow.step) {
    case "welcome":
      return <WelcomeStep />;
    case "choose_setup":
      return <SetupChoiceStep setupChoice={flow.setupChoice} onSetupChoice={flow.handleSetupChoice} />;
    case "account":
      return (
        <AccountStep
          accountConnected={flow.accountConnected}
          onStartCloudTrialWithEmail={onStartCloudTrialWithEmail}
          onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
        />
      );
    case "job":
      return (
        <JobStep
          mainActivities={flow.mainActivities}
          mainActivityOther={flow.mainActivityOther}
          workDomain={flow.workDomain}
          workDomainOther={flow.workDomainOther}
          onAddMainActivity={flow.addMainActivity}
          onMainActivityOtherChange={flow.setMainActivityOther}
          onToggleMainActivity={flow.toggleMainActivity}
          onWorkDomainChange={flow.setWorkDomain}
          onWorkDomainOtherChange={flow.setWorkDomainOther}
        />
      );
    case "data_review":
      return <DataReviewStep />;
    case "connect_server":
      return (
        <ConnectServerStep
          actionModelId={flow.managedLocalAi.actionModelId}
          apiKey={flow.apiKey}
          apiKeyIsValid={flow.apiKeyIsValid}
          catalog={flow.managedLocalAi.catalog}
          customEndpointBaseUrlIssue={flow.customEndpointBaseUrlIssue}
          customEndpointDraft={flow.customEndpointDraft}
          customEndpointModelIssue={flow.customEndpointModelIssue}
          isByokSetup={flow.isByokSetup}
          isCustomEndpointSetup={flow.isCustomEndpointSetup}
          loading={flow.managedLocalAi.loading}
          setupChoice={flow.setupChoice}
          status={flow.managedLocalAi.status}
          onApiKeyChange={flow.handleApiKeyChange}
          onCustomEndpointDraftChange={flow.handleCustomEndpointDraftChange}
          onInstallModel={flow.managedLocalAi.installModel}
        />
      );
    case "test_connection":
      return (
        <TestConnectionStep
          checkStatuses={flow.checkStatuses}
          connectionChecks={flow.connectionChecks}
          connectionFailureLabel={flow.connectionFailureLabel}
          connectionPhase={flow.connectionPhase}
          isByokSetup={flow.isByokSetup}
          isCustomEndpointSetup={flow.isCustomEndpointSetup}
          onEditConnection={() => flow.setStep("connect_server")}
          onRetry={() => flow.setTestRunId((id) => id + 1)}
        />
      );
    case "self_data_review":
      return (
        <SelfDataReviewStep
          customEndpointDraft={flow.customEndpointDraft}
          isByokSetup={flow.isByokSetup}
          isCustomEndpointSetup={flow.isCustomEndpointSetup}
          maskedApiKey={flow.maskedApiKey}
        />
      );
    case "permissions":
      return (
        <PermissionsStep
          accessibilityGranted={flow.accessibilityGranted}
          accessibilityReady={flow.accessibilityReady}
          notificationPermission={flow.notificationPermission}
          notificationsReady={flow.notificationsReady}
          openingSettingsPane={flow.openingSettingsPane}
          onNotificationPermission={() => void flow.handleNotificationPermissionClick()}
          onRequestAccessibility={() => void flow.handleRequestAccessibilityClick()}
          safariHistoryShow={flow.safariHistoryPermission.show}
          safariHistoryReadable={flow.safariHistoryPermission.readable}
          safariHistoryOpening={flow.safariHistoryPermission.opening}
          onEnableSafariHistory={flow.safariHistoryPermission.onEnable}
        />
      );
    case "nudges":
      return (
        <NudgesStep
          driftAlarmEnabled={flow.driftAlarmEnabled}
          extremeNudgeEnabled={flow.extremeNudgeEnabled}
          onDriftAlarmChange={flow.setDriftAlarmEnabled}
          onExtremeNudgeChange={flow.setExtremeNudgeEnabled}
        />
      );
    case "ready":
      return (
        <ReadyStep
          browserHistoryBootstrapEnabled={flow.browserHistoryBootstrapEnabled}
          cloudTrialStartedNotice={flow.cloudTrialStartedNotice}
          isUserManagedProviderSetup={flow.isUserManagedProviderSetup}
          localAiSummaryLabel={flow.localAiSummaryLabel}
          openAtLoginEnabled={flow.openAtLoginEnabled}
          permissionSummaryLabel={flow.permissionSummaryLabel}
          setupChoice={flow.setupChoice}
          userManagedConnectionLabel={flow.userManagedConnectionLabel}
          userManagedSetupLabel={flow.userManagedSetupLabel}
          onBrowserHistoryBootstrapChange={flow.setBrowserHistoryBootstrapEnabled}
          onOpenAtLoginChange={flow.setOpenAtLoginEnabled}
        />
      );
    case "privacy":
      return <PrivacyStep />;
    case "work_profile":
      return (
        <WorkProfileStep
          workDomain={flow.workDomain}
          workDomainOther={flow.workDomainOther}
          workType={flow.workType}
          workTypeOther={flow.workTypeOther}
          onWorkDomainChange={flow.setWorkDomain}
          onWorkDomainOtherChange={flow.setWorkDomainOther}
          onWorkTypeChange={flow.setWorkType}
          onWorkTypeOtherChange={flow.setWorkTypeOther}
        />
      );
    case "accessibility":
      return (
        <AccessibilityStep
          accessibilityJustGranted={flow.accessibilityJustGranted}
          accessibilityReady={flow.accessibilityReady}
          openingSettingsPane={flow.openingSettingsPane}
          onOpenAccessibilitySettings={() => void flow.handleOpenSettingsPane("accessibility")}
          onRefreshTracker={() => void flow.handleRefreshTrackerClick()}
        />
      );
    case "notifications":
      return (
        <NotificationsStep
          notificationPermission={flow.notificationPermission}
          notificationsReady={flow.notificationsReady}
          openingSettingsPane={flow.openingSettingsPane}
          onNotificationPermission={() => void flow.handleNotificationPermissionClick()}
          onOpenNotificationSettings={() => void flow.handleOpenSettingsPane("notifications")}
        />
      );
  }
}
