import type { Dispatch, ReactNode, SetStateAction } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import ollamaLogoUrl from "../../assets/ollama-logo.svg";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";
import { formatCloudTrialStartedDetail } from "../billing/CloudTrialStartedNotice";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import type { LocalAiSetupState } from "./localAiSetup";

export const AI_SETUP_SECTIONS = [
  { id: "cloud", title: "Drifty Cloud", subtitle: "Hosted classification through Drifty billing" },
  { id: "local", title: "OpenRouter BYOK", subtitle: "Use your own OpenRouter key and model routing" },
  { id: "ollama", title: "Local Ollama", subtitle: "Point Drifty at a local OpenAI-compatible endpoint" },
] as const;

export type AiSetupSection = (typeof AI_SETUP_SECTIONS)[number]["id"];

type AiSetupSectionCardProps = {
  readonly section: (typeof AI_SETUP_SECTIONS)[number];
  readonly expanded: boolean;
  readonly badges: readonly string[];
  readonly children: ReactNode;
  readonly onToggle: (section: AiSetupSection) => void;
};

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
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
};

type OpenRouterSetupPanelProps = {
  readonly fallbackCount: number;
  readonly localAiSetup: LocalAiSetupState;
  readonly primaryModel: string;
  readonly onChooseModels: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
};

type OllamaSetupPanelProps = {
  readonly localAiSetup: LocalAiSetupState;
  readonly modelSummary: string;
  readonly onChooseModel: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function AiSetupSectionCard({
  section,
  expanded,
  badges,
  children,
  onToggle,
}: AiSetupSectionCardProps) {
  const panelId = `ai-setup-section-${section.id}`;
  const buttonId = `ai-setup-section-button-${section.id}`;

  return (
    <article className={`ai-setup-choice${expanded ? " is-expanded" : ""}`}>
      <button
        id={buttonId}
        type="button"
        className="ai-setup-choice__toggle"
        aria-label={`${section.title} setup row`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(section.id)}
      >
        <BrandMark section={section.id} />
        <span className="ai-setup-choice__copy">
          <span className="ai-setup-choice__title">{section.title}</span>
          <span className="ai-setup-choice__subtitle">{section.subtitle}</span>
        </span>
        <span className="ai-setup-choice__badges" aria-hidden="true">
          {badges.map((badge) => (
            <span key={badge} className="ai-setup-choice__badge">{badge}</span>
          ))}
        </span>
        <span className="ai-setup-choice__chevron" aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={panelId} className="ai-setup-choice__panel" role="region" aria-labelledby={buttonId}>
          {children}
        </div>
      ) : null}
    </article>
  );
}

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
  onRefreshCloudStatus,
  onStartCloudSetup,
}: CloudSetupPanelProps) {
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const isCurrentTrial = isCurrentCloudPlan && billingEntitlementStatus === "trialing";
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
  fallbackCount,
  localAiSetup,
  primaryModel,
  onChooseModels,
  onLocalAiSetupChange,
}: OpenRouterSetupPanelProps) {
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
    </div>
  );
}

export function OllamaSetupPanel({
  localAiSetup,
  modelSummary,
  onChooseModel,
  onLocalAiSetupChange,
}: OllamaSetupPanelProps) {
  const hasModel = Boolean(localAiSetup.selfHostedModel.trim());

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
    </div>
  );
}

function BrandMark({ section }: { readonly section: AiSetupSection }) {
  switch (section) {
    case "cloud":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--cloud" aria-hidden="true">
          <img src={driftyLogoUrl} alt="" />
        </span>
      );
    case "local":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--openrouter" aria-hidden="true">
          <img src={openRouterLogoUrl} alt="" />
        </span>
      );
    case "ollama":
      return (
        <span className="ai-setup-brand-mark ai-setup-brand-mark--ollama" aria-hidden="true">
          <img src={ollamaLogoUrl} alt="" />
        </span>
      );
    default:
      return assertNever(section);
  }
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
  if (!isSupabaseConfigured) return "Set up Drifty Cloud";
  if (isCurrentCloudPlan) return "Refresh Drifty Cloud";
  return "Set up Drifty Cloud";
}

function assertNever(value: never): never {
  throw new AiSetupSectionCardError(String(value));
}

class AiSetupSectionCardError extends Error {
  constructor(readonly section: string) {
    super(`Unhandled AI setup section: ${section}`);
    this.name = "AiSetupSectionCardError";
  }
}
