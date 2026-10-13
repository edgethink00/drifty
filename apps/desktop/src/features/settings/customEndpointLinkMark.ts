/**
 * Diagonal chain for a user-supplied model endpoint.
 * Open hooks, not closed rings: overlapping rings fill their holes at the
 * 16px dropdown. Both call sites use this 24px viewBox; settings strokes it
 * at 2.3 and onboarding at 1.7.
 */
export const CUSTOM_ENDPOINT_LINK_PATHS = [
  "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
  "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
] as const;
