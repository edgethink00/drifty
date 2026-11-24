import { useEffect, useRef, useState, type ReactNode } from "react";
import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { useLocalization } from "../localization/LocalizationContext";
import { cliCommands, isWindowsHost, useCliInstalls, type CliInstall } from "../onboarding/cliInstall";
import { cliProviderName, type CliSetupChoice } from "../onboarding/cliPilot";

/**
 * How a provider card arranges its two ways to connect: the person's own
 * subscription through a CLI (Claude Code, Codex CLI) and an API key.
 * Development review only: ?providerCard=api-first|tabs|choices.
 */
export type ProviderCardLayout = "cli-first" | "api-first" | "tabs" | "choices";

export function providerCardLayout(search = typeof window === "undefined" ? "" : window.location.search): ProviderCardLayout {
  if (!import.meta.env.DEV) return "cli-first";
  const value = new URLSearchParams(search).get("providerCard");
  return value === "api-first" || value === "tabs" || value === "choices" ? value : "cli-first";
}

type Method = "cli" | "api";

export function ProviderConnectionMethods({
  choice,
  providerName,
  cliOffered,
  cliActive,
  apiActive,
  apiConfigured,
  detect,
  onUseCli,
  api,
}: {
  readonly choice: CliSetupChoice;
  readonly providerName: string;
  /** False on Windows for someone not already using the CLI: only the key fields show. */
  readonly cliOffered: boolean;
  readonly cliActive: boolean;
  readonly apiActive: boolean;
  readonly apiConfigured: boolean;
  /** Looks for the CLI only while the card is open; the check spends no plan usage. */
  readonly detect: boolean;
  readonly onUseCli: () => void;
  readonly api: ReactNode;
}): JSX.Element {
  const { t } = useLocalization();
  const layout = providerCardLayout();
  const initialMethod: Method = cliActive ? "cli" : apiActive || apiConfigured ? "api" : "cli";
  const [method, setMethod] = useState<Method>(initialMethod);
  useEffect(() => {
    if (cliActive) setMethod("cli");
  }, [cliActive]);
  if (!cliOffered) return <>{api}</>;
  const name = cliProviderName(choice);
  const cli = (compact = false) => (
    <CliSubscriptionBlock choice={choice} active={cliActive} detect={detect} compact={compact} onConnect={onUseCli} />
  );
  switch (layout) {
    case "api-first":
      return <>
        {api}
        <p className="ai-setup-local-divider ai-setup-method-divider">{t("settings.ai.cli.orSubscription")}</p>
        {cli()}
      </>;
    case "tabs":
      return <div className="ai-setup-methods ai-setup-methods--tabs">
        <div className="seg ai-setup-methods__seg" role="group" aria-label={t("settings.ai.method.aria", { provider: providerName })}>
          {(["cli", "api"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={method === value} className={method === value ? "on" : undefined} onClick={() => setMethod(value)}>
              {t(value === "cli" ? "settings.ai.method.subscription" : "settings.ai.method.apiKey")}
            </button>
          ))}
        </div>
        {method === "cli" ? cli() : api}
      </div>;
    case "choices":
      return <div className="ai-setup-methods ai-setup-methods--choices" role="radiogroup" aria-label={t("settings.ai.method.aria", { provider: providerName })}>
        {(["cli", "api"] as const).map((value) => {
          const selected = method === value;
          const inUse = value === "cli" ? cliActive : apiActive;
          return <div key={value} className={`ai-setup-method${selected ? " is-selected" : ""}`}>
            <button type="button" role="radio" aria-checked={selected} className="ai-setup-method__choice" onClick={() => setMethod(value)}>
              <span className="ai-setup-method__radio" aria-hidden="true" />
              {value === "cli" ? aiProviderBrandMark(choice) : <ApiKeyMark />}
              <span className="ai-setup-method__copy">
                <span className="ai-setup-choice__title">{t(value === "cli" ? "settings.ai.method.subscription" : "settings.ai.method.apiKey")}</span>
                <span className="ai-setup-method__hint">{value === "cli" ? t("settings.ai.method.subscriptionHint", { provider: name }) : t("settings.ai.method.apiKeyHint")}</span>
              </span>
              {inUse ? <span className="ai-setup-cli__state">{t("settings.ai.cli.inUse")}</span> : null}
            </button>
            {selected ? <div className="ai-setup-method__body">{value === "cli" ? cli(true) : api}</div> : null}
          </div>;
        })}
      </div>;
    case "cli-first":
    default:
      return <>
        {cli()}
        <p className="ai-setup-local-divider ai-setup-method-divider">{t("settings.ai.cli.orApiKey")}</p>
        {api}
      </>;
  }
}

/** Claude Code or Codex CLI on this Mac: whether it is installed and signed in, and what to run if not. */
export function CliSubscriptionBlock({ choice, active, detect, compact = false, onConnect }: {
  readonly choice: CliSetupChoice;
  readonly active: boolean;
  readonly detect: boolean;
  readonly compact?: boolean;
  readonly onConnect: () => void;
}): JSX.Element {
  const { t } = useLocalization();
  const name = cliProviderName(choice);
  const commands = cliCommands(choice, isWindowsHost());
  const { installs, recheck } = useCliInstalls(detect && !active);
  const install: CliInstall | null = active ? null : installs[choice];
  // One action at a time: connect once the CLI is ready, otherwise check again after the fix.
  const needsFix = install?.state === "missing" || install?.state === "unavailable" || (install?.state === "found" && install.signedIn === false);
  const action = active
    ? <span className="ai-setup-cli__state">{t("settings.ai.cli.inUse")}</span>
    : needsFix
      ? <button type="button" className="app-btn app-btn--secondary ai-setup-cli__action" onClick={recheck}>{t("onboarding.cli.checkAgain")}</button>
      : <button type="button" className="app-btn app-btn--secondary ai-setup-cli__action" disabled={install?.state === "checking"} onClick={onConnect}>{t("settings.ai.cli.connect")}</button>;
  const status = install ? <CliStatusLine install={install} name={name} /> : null;
  const fix = install ? <CliFix install={install} commands={commands} /> : null;
  if (compact) {
    return (
      <div className="ai-setup-cli ai-setup-cli--compact" role="group" aria-label={name}>
        <div className="ai-setup-cli__row">{status ?? <span />}{action}</div>
        {fix}
      </div>
    );
  }
  return (
    <div className="ai-setup-cli" role="group" aria-label={name}>
      <div className="ai-setup-cli__head">
        {aiProviderBrandMark(choice)}
        <span className="ai-setup-cli__copy">
          <span className="ai-setup-choice__title">{name}</span>
          <span className="ai-setup-cli__description">{t("onboarding.cli.listDescription", { provider: name })}</span>
        </span>
        {action}
      </div>
      {install ? <div className="ai-setup-cli__body">{status}{fix}</div> : null}
    </div>
  );
}

function CliStatusLine({ install, name }: { readonly install: CliInstall; readonly name: string }): JSX.Element {
  const { t } = useLocalization();
  switch (install.state) {
    case "checking":
      return <p className="ai-setup-cli__status" data-state="checking" role="status">{t("onboarding.cli.connectSearching", { provider: name })}</p>;
    case "found":
      if (install.signedIn === false) {
        return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("onboarding.cli.stepLoginNeeded", { provider: name })}</p>;
      }
      return <p className="ai-setup-cli__status" data-state="ready" role="status">
        {install.signedIn ? t("onboarding.cli.stepLoginDone", { provider: name }) : t("onboarding.cli.connectFound", { provider: name })}
        {install.version ? <span className="ai-setup-cli__version">v{install.version}</span> : null}
      </p>;
    case "missing":
      return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("onboarding.cli.connectMissing", { provider: name })}</p>;
    case "unavailable":
    default:
      return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("onboarding.cli.connectUnavailable", { provider: name })}</p>;
  }
}

/** The Terminal command that fixes a missing or signed-out CLI, then a pointer to Check again. */
function CliFix({ install, commands }: {
  readonly install: CliInstall;
  readonly commands: { readonly install: string; readonly login: string };
}): JSX.Element | null {
  const { t } = useLocalization();
  if (install.state === "missing") {
    return <><CliCommandLine command={commands.install} /><p className="ai-setup-cli__hint">{t("onboarding.cli.installThenCheck")}</p></>;
  }
  if (install.state === "found" && install.signedIn === false) {
    return <><CliCommandLine command={commands.login} /><p className="ai-setup-cli__hint">{t("onboarding.cli.loginThenCheck")}</p></>;
  }
  return null;
}

/** A neutral key badge for the API-key choice, so the provider's own mark is not repeated under its header. */
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

/** A Terminal command with a copy button, in the settings card's own style. */
function CliCommandLine({ command }: { readonly command: string }): JSX.Element {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      const element = codeRef.current;
      const selection = window.getSelection();
      if (!element || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  return <div className="ai-setup-cli__command">
    <span aria-hidden="true">{isWindowsHost() ? ">" : "$"}</span>
    <code ref={codeRef}>{command}</code>
    <button type="button" onClick={() => void copy()} aria-live="polite">{t(copied ? "onboarding.cli.copied" : "onboarding.cli.copy")}</button>
  </div>;
}

