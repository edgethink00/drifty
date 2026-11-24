import type { ReactNode } from "react";
import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { useLocalization } from "../localization/LocalizationContext";
import { cliCommands, isWindowsHost, useCliInstalls, type CliInstall } from "../onboarding/cliInstall";
import { cliProviderName, type CliSetupChoice } from "../onboarding/cliPilot";

/**
 * A provider card's two ways to connect, set out alike: the person's own
 * subscription through its CLI, then an API key. Each has its name with a
 * status and at most one action on the right. The model is chosen once in the
 * model menu; this card only decides which connection runs it.
 */
export function ProviderConnectionMethods({ choice, cliOffered, cliActive, apiActive, apiConfigured, providerName, detect, onUseCli, onUseApi, api }: {
  readonly choice: CliSetupChoice;
  /** False on Windows for someone not already using the CLI: only the key fields show. */
  readonly cliOffered: boolean;
  readonly cliActive: boolean;
  readonly apiActive: boolean;
  /** A saved key, so someone on another connection can switch to it without retyping. */
  readonly apiConfigured: boolean;
  readonly providerName: string;
  /** Looks for the CLI only while the card is open; the check spends no plan usage. */
  readonly detect: boolean;
  readonly onUseCli: () => void;
  readonly onUseApi: () => void;
  readonly api: ReactNode;
}): JSX.Element {
  const { t } = useLocalization();
  if (!cliOffered) return <>{api}</>;
  const title = t("settings.intelligence.apiKey");
  return <>
    <CliSubscriptionBlock choice={choice} active={cliActive} detect={detect} onConnect={onUseCli} />
    <div className="ai-setup-cli ai-setup-api-head" role="group" aria-label={title}>
      <ApiKeyMark />
      <span className="ai-setup-cli__copy">
        <span className="ai-setup-cli__title-line">
          <span className="ai-setup-choice__title">{title}</span>
          {apiActive
            ? <span className="ai-setup-cli__status" data-state="active" role="status">{t("settings.ai.cli.inUse")}</span>
            : apiConfigured ? <span className="ai-setup-cli__status" data-state="ready" role="status">{t("settings.ai.apiKey.saved")}</span> : null}
        </span>
        <span className="ai-setup-cli__description">{t("settings.ai.apiKey.description", { provider: providerName })}</span>
      </span>
      {apiConfigured && !apiActive
        ? <button type="button" className="app-btn app-btn--secondary ai-setup-cli__action" onClick={onUseApi}>{t("settings.ai.apiKey.connect")}</button>
        : null}
    </div>
    <div className="ai-setup-api-body">{api}</div>
  </>;
}

/** A neutral key badge for the API-key connection, beside the CLI's own mark. */
function ApiKeyMark(): JSX.Element {
  return (
    <span className="ai-setup-brand-mark ai-setup-brand-mark--key" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="8" cy="15" r="4" />
        <path d="M10.85 12.15 19 4" />
        <path d="m18 5 2 2" />
        <path d="m15 8 2 2" />
      </svg>
    </span>
  );
}

/**
 * Claude Code or Codex CLI on this Mac in two lines: its name with a short
 * status, then what it does, or how to sign in when that is what is missing.
 */
export function CliSubscriptionBlock({ choice, active, detect, onConnect }: {
  readonly choice: CliSetupChoice;
  readonly active: boolean;
  readonly detect: boolean;
  readonly onConnect: () => void;
}): JSX.Element {
  const { t } = useLocalization();
  const name = cliProviderName(choice);
  const { installs, recheck } = useCliInstalls(detect && !active);
  const install: CliInstall | null = active ? null : installs[choice];
  const signedOut = install?.state === "found" && install.signedIn === false;
  // Status always sits beside the name; the right side holds at most one action:
  // connect once the CLI is ready, otherwise check again after the fix.
  const needsFix = signedOut || install?.state === "missing" || install?.state === "unavailable";
  const action = active
    ? null
    : needsFix
      ? <button type="button" className="app-btn app-btn--secondary ai-setup-cli__action" onClick={recheck}>{t("onboarding.cli.checkAgain")}</button>
      : <button type="button" className="app-btn app-btn--secondary ai-setup-cli__action" disabled={install?.state === "checking"} onClick={onConnect}>{t("settings.ai.cli.connect")}</button>;
  return (
    <div className="ai-setup-cli" role="group" aria-label={name}>
      {aiProviderBrandMark(choice)}
      <span className="ai-setup-cli__copy">
        <span className="ai-setup-cli__title-line">
          <span className="ai-setup-choice__title">{name}</span>
          {active
            ? <span className="ai-setup-cli__status" data-state="active" role="status">{t("settings.ai.cli.inUse")}</span>
            : install ? <CliStatus install={install} /> : null}
        </span>
        <span className="ai-setup-cli__description">
          {signedOut
            ? <SignInHint command={cliCommands(choice, isWindowsHost()).login} />
            : t("settings.ai.cli.description", { account: choice === "claude_cli" ? "Claude" : "ChatGPT" })}
        </span>
      </span>
      {action}
    </div>
  );
}

function CliStatus({ install }: { readonly install: CliInstall }): JSX.Element {
  const { t } = useLocalization();
  const [state, key] = install.state === "checking" ? ["checking", "settings.ai.cli.status.checking"] as const
    : install.state === "missing" ? ["attention", "settings.ai.cli.status.missing"] as const
    : install.state === "unavailable" ? ["attention", "settings.ai.cli.status.unavailable"] as const
    : install.signedIn === false ? ["attention", "settings.ai.cli.status.signedOut"] as const
    : ["ready", install.signedIn ? "settings.ai.cli.status.ready" : "settings.ai.cli.status.found"] as const;
  // The version stays one hover away; it helps support but is noise in the row.
  const version = install.state === "found" && install.version ? `v${install.version}` : undefined;
  return <span className="ai-setup-cli__status" data-state={state} role="status" title={version}>{t(key)}</span>;
}

const COMMAND_SLOT = "\u2063";

/** "Sign in with claude in Terminal, then check again", with the command set in code. */
function SignInHint({ command }: { readonly command: string }): JSX.Element {
  const { t } = useLocalization();
  const [before, after = ""] = t("settings.ai.cli.signInHint", { command: COMMAND_SLOT }).split(COMMAND_SLOT);
  return <>{before}<code>{command}</code>{after}</>;
}

