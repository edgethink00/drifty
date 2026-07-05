import { BrowserHistoryBootstrapPreference } from "../BrowserHistoryBootstrapPreference";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { TRIAL_DAYS, ToggleButton } from "./shared";

export function ReadyStep({ flow }: { readonly flow: OnboardingFlow }) {
  const summaryItems = summaryItemsForFlow(flow);

  return (
    <>
      <p className="dc-onb-copy dc-onb-ready-copy">
        Drifty will now track your focus and drift in the background while you work.
      </p>
      <ul className="dc-onb-ready-list">
        {summaryItems.map((item, index) => (
          <li className="dc-onb-ready-item" key={item.label}>
            <CheckMarkIcon />
            {item.sub ? (
              <span className="dc-onb-ready-item__stack">
                <strong>{item.label}</strong>
                <span>{item.sub}</span>
              </span>
            ) : (
              <span className="dc-onb-ready-item__label">{item.label}</span>
            )}
            {index === 0 ? null : <span className="dc-onb-ready-item__divider" aria-hidden="true" />}
          </li>
        ))}
      </ul>
      <div className="dc-onb-login-row">
        <h2>Start Drifty at login</h2>
        <ToggleButton
          label="Start Drifty at login"
          on={flow.openAtLoginEnabled}
          compact
          onClick={() => flow.setOpenAtLoginEnabled((current) => !current)}
        />
      </div>
      <BrowserHistoryBootstrapPreference
        enabled={flow.browserHistoryBootstrapEnabled}
        onChange={flow.setBrowserHistoryBootstrapEnabled}
      />
      <p className="dc-onb-muted-note dc-onb-muted-note--ready">You can pause Drifty any time from the menu bar.</p>
    </>
  );
}

function summaryItemsForFlow(flow: OnboardingFlow): ReadonlyArray<{ readonly label: string; readonly sub?: string }> {
  if (flow.setupChoice === "local_ai" || flow.isUserManagedProviderSetup) {
    return [
      { label: flow.setupChoice === "local_ai" ? "Local AI selected" : flow.isByokSetup ? "BYOK selected" : "Custom endpoint selected" },
      { label: "Account connected" },
      {
        label: flow.setupChoice === "local_ai"
          ? flow.managedLocalReady ? "Local model ready" : "Local model downloading"
          : flow.isByokSetup ? "OpenRouter key connected" : "Custom endpoint connected",
      },
      { label: "Tracking ready" },
    ];
  }
  return [
    { label: "Drifty Cloud selected" },
    { label: "Account connected" },
    { label: `${TRIAL_DAYS}-day free trial started`, sub: "Your Drifty Cloud trial is ready." },
    { label: "Tracking ready" },
  ];
}

function CheckMarkIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M4 12.5l4.5 4.5L20 6" stroke="#1c1c19" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
