type AiSetupConnectionTestRowProps = {
  readonly buttonLabel: string;
  readonly disabled: boolean;
  readonly message: string | null;
  readonly providerLabel: string;
  readonly onTestConnection: () => void | Promise<void>;
};

export function AiSetupConnectionTestRow({
  buttonLabel,
  disabled,
  message,
  providerLabel,
  onTestConnection,
}: AiSetupConnectionTestRowProps) {
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
