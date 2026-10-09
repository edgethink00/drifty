import { Fragment, useMemo, useState } from "react";
import driftyWordmarkUrl from "../../../../assets/drifty-wordmark-trim.png";
import { AuthModal } from "../../../auth/AuthModal";
import type { OAuthCallbackStatus } from "../../../auth/AuthContext";
import { useLocalization } from "../../../localization/LocalizationContext";
import { DEV_ONBOARDING_AUTH_SKIP_ENABLED } from "../../../../appFeatureSwitches";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { entryReviewAccountProps, readEntryReviewState } from "../../entryReviewState";
import { EntryDayDemo } from "../EntryDayDemo";
import { OnboardingLanguageToggle } from "../OnboardingLanguageToggle";
import { AccountStep } from "./AccountStep";

/**
 * The first onboarding screen: what Drifty does and how to start, side by side. The left
 * column carries the headline and sign-in, and switches to the in-place email form without
 * leaving the screen; the right column keeps the product picture running throughout.
 */
export function OnboardingEntryStep({
  flow,
  authCallbackStatus,
  onStartCloudTrialWithGoogle,
  onStartCloudTrialWithWebsite,
  onDeleteAnonymousAccount,
}: {
  readonly flow: OnboardingFlow;
  readonly authCallbackStatus: OAuthCallbackStatus | null;
  readonly onStartCloudTrialWithGoogle: () => void;
  readonly onStartCloudTrialWithWebsite?: () => void;
  readonly onDeleteAnonymousAccount?: () => void;
}) {
  const { t } = useLocalization();
  const reviewState = useMemo(readEntryReviewState, []);
  const [emailOpen, setEmailOpen] = useState(reviewState === "email");
  const account = {
    accountConnected: flow.accountConnected,
    accountAccessState: flow.accountAccessState,
    awaitsContinue: flow.entryAwaitsContinue,
    expectsPromotion: flow.expectsPromotion,
    promotionActive: flow.promotionActive,
    promotionEndsAt: flow.promotionEndsAt,
    authCallbackStatus,
    onStartCloudTrialWithWebsite,
    ...entryReviewAccountProps(reviewState),
  };
  const showEmail = emailOpen && flow.step === "account" && !account.accountConnected;
  const showPromoEntry = account.expectsPromotion && !account.accountConnected && account.onStartCloudTrialWithWebsite !== undefined;
  // The headline's line breaks belong to the copy, so they are written into the translation.
  const headlineLines = (showPromoEntry ? t("auth.modal.promoTitle") : t("onboarding.entry.headline")).split("\n");

  return (
    <div className="onboarding-card dc-onb-card onb-entry" data-step={flow.step} data-view={showEmail ? "email" : "providers"}>
      <section className="onb-entry__copy">
        <h1 className="onb-visually-hidden" id="onboarding-title" ref={flow.titleRef} tabIndex={-1}>
          {flow.title}
        </h1>
        <div className="onb-entry__top">
          {showEmail ? (
            <button
              type="button"
              className="onb-entry__back"
              onClick={() => setEmailOpen(false)}
              aria-label={t("onboarding.entry.otherOptions")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m14.5 6-6 6 6 6" />
              </svg>
            </button>
          ) : (
            <img className="onb-entry__wordmark" src={driftyWordmarkUrl} alt="drifty" />
          )}
          {showEmail ? null : <OnboardingLanguageToggle />}
        </div>
        {showEmail ? (
          <div className="onb-entry__email">
            <AuthModal presentation="inline" showGoogleSignIn={false} onClose={() => setEmailOpen(false)} />
          </div>
        ) : (
          <>
            <div className="onb-entry__pitch">
              <p className="onb-entry__headline">
                {headlineLines.map((line, index) => (
                  <Fragment key={line}>
                    {index > 0 ? <br /> : null}
                    {index > 0 ? " " : null}
                    {line}
                  </Fragment>
                ))}
              </p>
              <p className="onb-entry__body">
                {showPromoEntry ? t("auth.modal.promoDescription") : t("onboarding.entry.body")}
              </p>
            </div>
            <AccountStep
              {...account}
              devAuthSkipEnabled={DEV_ONBOARDING_AUTH_SKIP_ENABLED && flow.step === "account"}
              onSkipAuthForDev={flow.skipAccountForDev}
              onContinue={flow.continueFromEntry}
              onOpenEmail={() => setEmailOpen(true)}
              onStartCloudTrialWithGoogle={onStartCloudTrialWithGoogle}
              onDeleteAnonymousAccount={onDeleteAnonymousAccount}
            />
          </>
        )}
      </section>
      <div className="onb-entry__stage">
        <EntryDayDemo />
      </div>
    </div>
  );
}
