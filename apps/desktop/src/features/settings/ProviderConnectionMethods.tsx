import { useEffect, useRef, useState, type ReactNode } from "react";
import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { useLocalization } from "../localization/LocalizationContext";
import { cliCommands, isWindowsHost, useCliInstalls, type CliInstall } from "../onboarding/cliInstall";
import { cliProviderName, type CliSetupChoice } from "../onboarding/cliPilot";

/**
 * Where a provider card puts the person's own subscription (Claude Code,
 * Codex CLI) relative to its API-key fields. Production shows the
 * subscription first; development review can compare ?providerCard=api-first.
 */
export type ProviderCardLayout = "cli-first" | "api-first";

export function providerCardLayout(search = typeof window === "undefined" ? "" : window.location.search): ProviderCardLayout {
  if (!import.meta.env.DEV) return "cli-first";
  return new URLSearchParams(search).get("providerCard") === "api-first" ? "api-first" : "cli-first";
}

export function ProviderConnectionMethods({ choice, cliOffered, cliActive, detect, onUseCli, api }: {
  readonly choice: CliSetupChoice;
  /** False on Windows for someone not already using the CLI: only the key fields show. */
  readonly cliOffered: boolean;
  readonly cliActive: boolean;
  /** Looks for the CLI only while the card is open; the check spends no plan usage. */
  readonly detect: boolean;
  readonly onUseCli: () => void;
  readonly api: ReactNode;
}): JSX.Element {
  const { t } = useLocalization();
  if (!cliOffered) return <>{api}</>;
  if (providerCardLayout() === "api-first") {
    return <>
      {api}
      <CliSubscriptionBlock choice={choice} active={cliActive} detect={detect} placement="after" onConnect={onUseCli} />
    </>;
  }
  return <>
    <CliSubscriptionBlock choice={choice} active={cliActive} detect={detect} placement="before" onConnect={onUseCli} />
    <p className="ai-setup-local-divider ai-setup-method-divider">{t("settings.ai.cli.orApiKey")}</p>
    {api}
  </>;
}

/** Claude Code or Codex CLI on this Mac: whether it is installed and signed in, and what to run if not. */
export function CliSubscriptionBlock({ choice, active, detect, placement, onConnect }: {
  readonly choice: CliSetupChoice;
  readonly active: boolean;
  readonly detect: boolean;
  /** "after" sets the block apart as a panel below the key fields. */
  readonly placement: "before" | "after";
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
  return (
    <div className={`ai-setup-cli ai-setup-cli--${placement}${active ? " is-active" : ""}`} role="group" aria-label={name}>
      <div className="ai-setup-cli__head">
        {aiProviderBrandMark(choice)}
        <span className="ai-setup-cli__copy">
          <span className="ai-setup-choice__title">{name}</span>
          <span className="ai-setup-cli__description">{t("settings.ai.cli.description", { account: choice === "claude_cli" ? "Claude" : "ChatGPT" })}</span>
        </span>
        {action}
      </div>
      {install ? <div className="ai-setup-cli__body"><CliStatusLine install={install} /><CliFix install={install} commands={commands} /></div> : null}
    </div>
  );
}

function CliStatusLine({ install }: { readonly install: CliInstall }): JSX.Element {
  const { t } = useLocalization();
  switch (install.state) {
    case "checking":
      return <p className="ai-setup-cli__status" data-state="checking" role="status">{t("settings.ai.cli.status.checking")}</p>;
    case "found":
      if (install.signedIn === false) {
        return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("settings.ai.cli.status.signedOut")}</p>;
      }
      return <p className="ai-setup-cli__status" data-state="ready" role="status">
        {t(install.signedIn ? "settings.ai.cli.status.ready" : "settings.ai.cli.status.found")}
        {install.version ? <span className="ai-setup-cli__version">v{install.version}</span> : null}
      </p>;
    case "missing":
      return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("settings.ai.cli.status.missing")}</p>;
    case "unavailable":
    default:
      return <p className="ai-setup-cli__status" data-state="attention" role="status">{t("settings.ai.cli.status.unavailable")}</p>;
  }
}

/** The Terminal command that fixes a missing or signed-out CLI, then a pointer to Check again. */
function CliFix({ install, commands }: {
  readonly install: CliInstall;
  readonly commands: { readonly install: string; readonly login: string };
}): JSX.Element | null {
  const { t } = useLocalization();
  const command = install.state === "missing" ? commands.install : install.state === "found" && install.signedIn === false ? commands.login : null;
  if (!command) return null;
  return <><CliCommandLine command={command} /><p className="ai-setup-cli__hint">{t("settings.ai.cli.fixHint")}</p></>;
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

