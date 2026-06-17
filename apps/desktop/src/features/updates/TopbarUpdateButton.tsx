import "./TopbarUpdateButton.css";

type TopbarUpdateButtonProps = {
  readonly isInstalling: boolean;
  readonly onInstall: () => void;
  readonly version: string;
};

export function TopbarUpdateButton({ isInstalling, onInstall, version }: TopbarUpdateButtonProps) {
  const label = isInstalling ? `Installing Drifty ${version} update` : `Install Drifty ${version} update`;

  return (
    <button
      type="button"
      className="topbar-update-button"
      aria-label={label}
      disabled={isInstalling}
      onClick={onInstall}
      title={label}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.5v6" />
        <path d="m5.5 6.4 2.5 2.5 2.5-2.5" />
        <path d="M3.5 10.8v1.4c0 .7.6 1.3 1.3 1.3h6.4c.7 0 1.3-.6 1.3-1.3v-1.4" />
      </svg>
      <span>{isInstalling ? "Installing" : "Update"}</span>
    </button>
  );
}
