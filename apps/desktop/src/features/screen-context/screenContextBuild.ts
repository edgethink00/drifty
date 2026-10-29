declare const __DRIFTY_SCREEN_CONTEXT_MODE__: "included" | "excluded";

/** A package choice, independent of capture preferences or existing OS grants. */
export const SCREEN_CONTEXT_BUILD_ENABLED = typeof __DRIFTY_SCREEN_CONTEXT_MODE__ === "undefined"
  || __DRIFTY_SCREEN_CONTEXT_MODE__ === "included";
