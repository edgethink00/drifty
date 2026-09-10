import type { TranslationKey } from "../localization/translations";
import type { AiConnectionIssueKind } from "./aiConnectionHealth";

/**
 * User-facing recovery guidance for a classified AI connection failure.
 *
 * `AiConnectionIssueKind` already carries the structured cause. This module is
 * the single place that decides what the user is told about it and whether the
 * failure is worth asking them to act on at all.
 *
 * Copy is referenced by translation key rather than English string. The AI
 * status pill localizes labels by looking up the English text
 * (`aiStatusTranslations.ts`), so any copy keyed on source text silently falls
 * back to English the moment the English wording changes.
 */
export type AiFailureGuidance = {
  readonly kind: AiConnectionIssueKind;
  /** True when classification cannot resume until the user changes something. */
  readonly needsUserAction: boolean;
  readonly headlineKey: TranslationKey;
  /** Concrete recovery step; null when retrying resolves the failure on its own. */
  readonly nextStepKey: TranslationKey | null;
};

/**
 * Every actionable failure is resolved from the AI settings surface, so this
 * module does not model a destination. If a future issue kind needs a different
 * destination (for example a Drifty Cloud entitlement problem, which today is
 * carried by the availability contract rather than by an issue kind), add the
 * destination here rather than at the call site.
 *
 * The actionable/transient split matches the sidebar recovery card, which has
 * shipped this judgment for longer: only rate limiting and provider capacity
 * resolve without the user. `SidebarCtaSlot` reads `needsUserAction` from here
 * so the pill and the card can never disagree about the same failure.
 */
const AI_FAILURE_GUIDANCE: Readonly<Record<AiConnectionIssueKind, AiFailureGuidance>> = {
  authentication: {
    kind: "authentication",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.authentication.headline",
    nextStepKey: "settings.ai.failure.authentication.nextStep",
  },
  credits: {
    kind: "credits",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.credits.headline",
    nextStepKey: "settings.ai.failure.credits.nextStep",
  },
  access: {
    kind: "access",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.access.headline",
    nextStepKey: "settings.ai.failure.access.nextStep",
  },
  model_unavailable: {
    kind: "model_unavailable",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.modelUnavailable.headline",
    nextStepKey: "settings.ai.failure.modelUnavailable.nextStep",
  },
  rate_limited: {
    kind: "rate_limited",
    needsUserAction: false,
    headlineKey: "settings.ai.failure.rateLimited.headline",
    nextStepKey: null,
  },
  unavailable: {
    kind: "unavailable",
    needsUserAction: false,
    headlineKey: "settings.ai.failure.unavailable.headline",
    nextStepKey: null,
  },
  network: {
    kind: "network",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.network.headline",
    nextStepKey: "settings.ai.failure.network.nextStep",
  },
  provider: {
    kind: "provider",
    needsUserAction: true,
    headlineKey: "settings.ai.failure.provider.headline",
    nextStepKey: "settings.ai.failure.provider.nextStep",
  },
};

/**
 * Shared reassurance appended to every failure explanation. Local activity
 * capture is independent of AI classification, so the question worth answering
 * is whether collection stopped, not whether stored history survived.
 *
 * The dashboard recovery overlay carries the same message, but it only appears
 * for unconfigured and billing-locked routes; `resolveDashboardAiUnavailableState`
 * returns null once a connected route goes `degraded`. For the failures this
 * module covers, the pill is the only surface saying it.
 */
export const AI_FAILURE_TRACKING_CONTINUES_KEY: TranslationKey = "settings.ai.failure.trackingContinues";

/**
 * True when the failure resolves on its own. The sidebar recovery card uses
 * this to decide whether to appear at all; the pill uses it to decide whether
 * to offer a next step.
 */
export function aiFailureResolvesWithoutUser(kind: AiConnectionIssueKind): boolean {
  return !AI_FAILURE_GUIDANCE[kind].needsUserAction;
}

export function aiFailureGuidance(kind: AiConnectionIssueKind): AiFailureGuidance {
  return AI_FAILURE_GUIDANCE[kind];
}

/** Translation keys for one failure, in display order. */
export function aiFailureGuidanceKeys(kind: AiConnectionIssueKind): readonly TranslationKey[] {
  const guidance = AI_FAILURE_GUIDANCE[kind];
  return guidance.nextStepKey
    ? [guidance.headlineKey, guidance.nextStepKey, AI_FAILURE_TRACKING_CONTINUES_KEY]
    : [guidance.headlineKey, AI_FAILURE_TRACKING_CONTINUES_KEY];
}
