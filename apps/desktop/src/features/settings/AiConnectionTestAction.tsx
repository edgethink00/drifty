import { ActionLabel } from "../../components/ActionLabel";
import { useLocalization } from "../localization/LocalizationContext";

type AiConnectionTestActionProps = {
  readonly running: boolean;
  readonly disabled: boolean;
  readonly onTest: () => void | Promise<void>;
};

export function AiConnectionTestAction({ running, disabled, onTest }: AiConnectionTestActionProps) {
  const { t } = useLocalization();
  return (
    <button
      type="button"
      className="ai-setup-current-model__test"
      aria-label={t("settings.ai.testConnectionAria")}
      aria-busy={running || undefined}
      disabled={disabled || running}
      onClick={() => void onTest()}
    >
      {/* Lucide RefreshCw, matching the selected design. */}
      <svg className={running ? "is-running" : undefined} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
      {/* The icon already turns while testing, so the label only swaps text; both
          labels share one grid cell so the chip keeps its width. */}
      <ActionLabel busy={false} reserve={[t(running ? "settings.ai.testConnection" : "settings.ai.testing")]}>
        {running ? t("settings.ai.testing") : t("settings.ai.testConnection")}
      </ActionLabel>
    </button>
  );
}
