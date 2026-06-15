import type { Dispatch, SetStateAction } from "react";

import { formatCloudTrialStartedDetail } from "../billing/CloudTrialStartedNotice";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import type { LocalAiSetupState } from "./localAiSetup";

type CloudSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly cloudStatusLabel: string;
  readonly cloudTrialEndsAt: string | null;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly userEmail: string | null;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
};

type OpenRouterSetupPanelProps = {
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly fallbackCount: number;
  readonly localAiSetup: LocalAiSetupState;
  readonly primaryModel: string;
  readonly onChooseModels: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onTestConnection: () => void | Promise<void>;
};

type OllamaSetupPanelProps = {
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly modelSummary: string;
  readonly onChooseModel: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onTestConnection: () => void | Promise<void>;
};

type ConnectionTestRowProps = {
  readonly buttonLabel: string;
  readonly disabled: boolean;
  readonly message: string | null;
  readonly providerLabel: string;
  readonly onTestConnection: () => void | Promise<void>;
};

export function CloudSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementStatus,
  billingPlansDisabled,
  cloudStatusRefreshing,
  cloudStatusLabel,
  cloudTrialEndsAt,
  currentBillingPlan,
  isSupabaseConfigured,
  shouldShowCloudCheckoutPlans,
  userEmail,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: CloudSetupPanelProps) {
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const isCurrentTrial = isCurrentCloudPlan && billingEntitlementStatus === "trialing";
  const maskedUserEmail = maskCloudAccountEmail(userEmail);
  const primaryActionLabel = cloudActionLabel({
    billingCheckoutLoadingInterval,
    cloudStatusRefreshing,
    isCurrentCloudPlan,
    isSupabaseConfigured,
  });
  const primaryActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null;
  const handlePrimaryAction = isCurrentCloudPlan ? onRefreshCloudStatus : () => onStartCloudSetup();

  return (
    <div className="ai-setup-detail ai-setup-detail--cloud" role="group" aria-label="Drifty Cloud settings">
      <div className="ai-setup-detail__summary">
        <span className="chip green">{aiServerStatusLabel}</span>
        <span>{cloudStatusLabel}</span>
        {maskedUserEmail ? <span>{maskedUserEmail}</span> : null}
        {billingEntitlementError ? <span className="ai-setup-detail__message">{billingEntitlementError}</span> : null}
      </div>
      <div className="ai-setup-cloud-route" aria-label="Drifty Cloud checkout route">
        <div>
          <strong>{isCurrentTrial ? "1-week free trial is active" : isCurrentCloudPlan ? "Cloud AI is active" : "Continue with Drifty Cloud"}</strong>
          <p>{isCurrentTrial ? formatCloudTrialStartedDetail(cloudTrialEndsAt) : isCurrentCloudPlan ? "Refresh the account entitlement if the status looks stale." : "Drifty will open the Polar checkout after account sign-in is confirmed."}</p>
        </div>
        <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handlePrimaryAction()} disabled={primaryActionDisabled}>
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}

export function OpenRouterSetupPanel({
  connectionTestMessage,
  connectionTestRunning,
  fallbackCount,
  localAiSetup,
  primaryModel,
  onChooseModels,
  onLocalAiSetupChange,
  onTestConnection,
}: OpenRouterSetupPanelProps) {
  const testDisabled = connectionTestRunning || !localAiSetup.openRouterApiKey.trim();

  return (
    <div className="ai-setup-detail" role="group" aria-label="OpenRouter BYOK settings">
      <label className="ai-setup-field">
        <span>OpenRouter API key</span>
        <input
          className="settings-input"
          type="password"
          autoComplete="off"
          aria-label="OpenRouter API key"
          value={localAiSetup.openRouterApiKey}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok", openRouterApiKey: event.target.value }))}
          placeholder="sk-or-v1-..."
        />
      </label>
      <div className="ai-setup-model-row">
        <div>
          <span className="chip green">Primary: {primaryModel}</span>
          {fallbackCount > 0 ? <span className="chip gray">{fallbackCount} fallback{fallbackCount === 1 ? "" : "s"}</span> : null}
        </div>
        <button type="button" className="settings-btn" aria-label="Choose OpenRouter models" onClick={onChooseModels}>Choose models</button>
      </div>
      <ConnectionTestRow
        buttonLabel={connectionTestRunning ? "Testing..." : "Test connection"}
        message={connectionTestMessage}
        providerLabel="OpenRouter"
        disabled={testDisabled}
        onTestConnection={onTestConnection}
      />
    </div>
  );
}

export function OllamaSetupPanel({
  connectionTestMessage,
  connectionTestRunning,
  localAiSetup,
  modelSummary,
  onChooseModel,
  onLocalAiSetupChange,
  onTestConnection,
}: OllamaSetupPanelProps) {
  const hasModel = Boolean(localAiSetup.selfHostedModel.trim());
  const testDisabled = connectionTestRunning || !localAiSetup.selfHostedBaseUrl.trim() || !hasModel;

  return (
    <div className="ai-setup-detail" role="group" aria-label="Self-hosted AI settings">
      <label className="ai-setup-field">
        <span>Self-hosted base URL</span>
        <input
          className="settings-input"
          aria-label="Self-hosted base URL"
          value={localAiSetup.selfHostedBaseUrl}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedBaseUrl: event.target.value }))}
          placeholder="http://localhost:11434/v1"
        />
      </label>
      <div className="ai-setup-model-row">
        <div><span className={hasModel ? "chip green" : "chip gray"}>{modelSummary}</span></div>
        <button type="button" className="settings-btn" aria-label="Choose self-hosted model" onClick={onChooseModel}>Choose model</button>
      </div>
      <ConnectionTestRow
        buttonLabel={connectionTestRunning ? "Testing..." : "Test connection"}
        message={connectionTestMessage}
        providerLabel="Ollama"
        disabled={testDisabled}
        onTestConnection={onTestConnection}
      />
    </div>
  );
}

function ConnectionTestRow({
  buttonLabel,
  disabled,
  message,
  providerLabel,
  onTestConnection,
}: ConnectionTestRowProps) {
  return (
    <div className="ai-setup-test-row">
      <div>
        <strong>Connection test</strong>
        <p>{message ?? "Send a minimal chat request through the selected provider before running classification."}</p>
      </div>
      <button
        type="button"
        className="settings-btn"
        aria-label={`Test ${providerLabel} connection`}
        onClick={() => void onTestConnection()}
        disabled={disabled}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function cloudActionLabel({
  billingCheckoutLoadingInterval,
  cloudStatusRefreshing,
  isCurrentCloudPlan,
  isSupabaseConfigured,
}: {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly cloudStatusRefreshing: boolean;
  readonly isCurrentCloudPlan: boolean;
  readonly isSupabaseConfigured: boolean;
}): string {
  if (billingCheckoutLoadingInterval !== null) return "Opening checkout...";
  if (cloudStatusRefreshing) return "Checking...";
  if (!isSupabaseConfigured || !isCurrentCloudPlan) return "Set up Drifty Cloud";
  return "Refresh Drifty Cloud";
}

function maskCloudAccountEmail(email: string | null): string | null {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;

  const [localPart, domain, ...extraParts] = trimmedEmail.split("@");
  if (!localPart || !domain || extraParts.length > 0) return trimmedEmail;
  return `${localPart.slice(0, Math.min(2, localPart.length))}***@${domain}`;
}
