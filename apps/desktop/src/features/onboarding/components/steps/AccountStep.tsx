import { GoogleMark } from "../GoogleMark";
import { SuccessIcon } from "./shared";

export function AccountStep({
  accountConnected,
  onStartCloudTrialWithEmail,
  onStartCloudTrialWithGoogle,
}: {
  readonly accountConnected: boolean;
  readonly onStartCloudTrialWithEmail: () => void;
  readonly onStartCloudTrialWithGoogle: () => void;
}) {
  return (
    <div className="dc-onb-account">
      <h2 className="dc-onb-account__title">Connect your account</h2>
      <p className="dc-onb-account__copy">
        Your account keeps focus and drift insights synced across your devices.
      </p>
      {accountConnected ? (
        <div className="dc-onb-account__connected" role="status">
          <SuccessIcon />
          <span>Account connected</span>
        </div>
      ) : (
        <div className="dc-onb-account__buttons">
          <button
            type="button"
            className="dc-onb-account__google"
            onClick={onStartCloudTrialWithGoogle}
          >
            <GoogleMark />
            <span>Continue with Google</span>
          </button>
          <div className="dc-onb-divider" aria-hidden="true">
            <span />
            or
            <span />
          </div>
          <button
            type="button"
            className="dc-onb-account__email"
            onClick={onStartCloudTrialWithEmail}
          >
            Continue with email
          </button>
        </div>
      )}
      <p className="dc-onb-account__helper">
        Drifty never shares your activity data with teammates unless you choose to join a team or share a report.
      </p>
      <p className="dc-onb-account__legal">
        By continuing, you accept{" "}
        <a href="https://drifty.so/terms/" target="_blank" rel="noreferrer">Terms</a>{" "}
        &amp; <a href="https://drifty.so/privacy/" target="_blank" rel="noreferrer">Privacy</a>.
      </p>
    </div>
  );
}
