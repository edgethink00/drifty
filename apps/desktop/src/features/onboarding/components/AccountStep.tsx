import { GoogleMark } from "./GoogleMark";

type AccountStepProps = {
  readonly accountConnected: boolean;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
};

export function AccountStep({
  accountConnected,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: AccountStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        Your account keeps your focus and drift insights synced across your devices.
      </p>
      <div className="onb-account">
        <button
          type="button"
          className="onb-button onb-button--primary onb-account__provider"
          onClick={onStartCloudTrialWithGoogle}
          disabled={accountConnected}
        >
          {accountConnected ? (
            "Account connected"
          ) : (
            <>
              <GoogleMark />
              <span>Continue with Google</span>
            </>
          )}
        </button>
        <button
          type="button"
          className="onb-button onb-button--ghost onb-account__provider"
          onClick={onStartCloudTrialWithEmail}
          disabled={accountConnected}
        >
          {accountConnected ? "Signed in" : "Continue with email"}
        </button>
      </div>
      <p className="onb-account__helper">
        Drifty never shares your activity data with teammates unless you choose to join a team or
        share a report.
      </p>
      <p className="onb-account__legal">
        By continuing, you accept{" "}
        <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">Terms</a>{" "}
        &amp; <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">Privacy</a>.
      </p>
    </>
  );
}
