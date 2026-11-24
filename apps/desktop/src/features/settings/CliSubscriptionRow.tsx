import { aiProviderBrandMark } from "./AiProviderBrandMark";
import { useLocalization } from "../localization/LocalizationContext";
import { cliCommands, isWindowsHost } from "../onboarding/cliInstall";
import { cliProviderName, type CliSetupChoice } from "../onboarding/cliPilot";

/**
 * The subscription way to use a provider, at the top of its card: Claude Code
 * inside Anthropic, Codex CLI inside OpenAI. The API-key fields follow it.
 */
export function CliSubscriptionRow({ choice, active, onConnect }: {
  readonly choice: CliSetupChoice;
  readonly active: boolean;
  readonly onConnect: () => void;
}): JSX.Element {
  const { t } = useLocalization();
  const name = cliProviderName(choice);
  const command = cliCommands(choice, isWindowsHost()).login;
  return (
    <>
      <div className="ai-setup-cli-row" role="group" aria-label={name}>
        {aiProviderBrandMark(choice)}
        <span className="ai-setup-cli-row__copy">
          <span className="ai-setup-choice__title">{name}</span>
          <span className="ai-setup-cli-row__description">{t("settings.ai.cli.rowDescription", { command })}</span>
        </span>
        {active ? (
          <span className="ai-setup-cli-row__state">{t("settings.ai.cli.inUse")}</span>
        ) : (
          <button type="button" className="app-btn app-btn--secondary ai-setup-cli-row__action" onClick={onConnect}>
            {t("settings.ai.cli.connect")}
          </button>
        )}
      </div>
      <p className="ai-setup-local-divider">{t("settings.ai.cli.orApiKey")}</p>
    </>
  );
}

