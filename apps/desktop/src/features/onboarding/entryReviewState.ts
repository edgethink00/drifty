import type { ComponentProps } from "react";
import type { AccountStep } from "./components/steps/AccountStep";

/**
 * Development review only: ?driftyEntryReview=<state> shows the onboarding entry screen in a
 * synthetic sign-in state so every state can be reviewed in a browser without an account,
 * network failure or OAuth round trip. Nothing is signed in, stored or sent. Production builds
 * compile readEntryReviewState() to null.
 */
export const ENTRY_REVIEW_STATES = [
  "email",
  "google-opening",
  "google-failed",
  "offline",
  "connected",
  "checking",
  "promo",
  "promo-connected",
] as const;
export type EntryReviewState = (typeof ENTRY_REVIEW_STATES)[number];

export function readEntryReviewState(): EntryReviewState | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("driftyEntryReview");
  return ENTRY_REVIEW_STATES.find((state) => state === value) ?? null;
}

type AccountStepReviewProps = Partial<ComponentProps<typeof AccountStep>>;

const REVIEW_PROMOTION_END = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

export function entryReviewAccountProps(state: EntryReviewState | null): AccountStepReviewProps {
  switch (state) {
    case "google-opening":
      return { authCallbackStatus: { phase: "waiting", message: "", method: "google", googleAction: "opening" } };
    case "google-failed":
      return {
        authCallbackStatus: {
          phase: "failed",
          message: "Google sign-in did not finish. Try again, or continue with email.",
          method: "google",
          googleAction: "retry",
        },
      };
    case "offline":
      return { cloudConnectionStatusOverride: "offline", onRetryCloudConnection: async () => ({ error: null }) };
    case "connected":
      return { accountConnected: true, accountAccessState: "standard-confirmed", awaitsContinue: true };
    case "checking":
      return { accountConnected: true, accountAccessState: "checking", awaitsContinue: false };
    case "promo":
      return { expectsPromotion: true, onStartCloudTrialWithWebsite: () => {} };
    case "promo-connected":
      return {
        accountConnected: true,
        accountAccessState: "promotion-confirmed",
        awaitsContinue: true,
        promotionActive: true,
        promotionEndsAt: REVIEW_PROMOTION_END,
      };
    case "email":
    case null:
      return {};
  }
}
