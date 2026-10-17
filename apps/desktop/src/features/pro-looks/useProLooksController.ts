import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  DEFAULT_APP_ICON_VARIANT,
  getAppIconVariant,
  previewAppIcon,
  setAppIconVariant,
  type AppIconVariantId,
} from "../../lib/api/appIconClient";
import type { PetModeCoat } from "../pet-mode/petModeData";
import {
  accentLookId,
  CUSTOM_ACCENT,
  DEFAULT_ACCENT,
  FREE_ACCENTS,
  FREE_APP_ICONS,
  FREE_FALLBACK_APP_ICON,
  FREE_FALLBACK_PET_COAT,
  FREE_PET_COATS,
  isKnownWithoutPro,
  isLookLocked,
  isProLook,
  readRevertedLooks,
  resolveKeptAccent,
  resolveKeptCoat,
  sameLook,
  writePetCoatPreview,
  writeRevertedLooks,
  type ProLook,
  type ProLooksAccess,
  type RevertedLooks,
} from "./proLooks";

/** How long a started unlock may wait for its sign-in, trial or Pro sheet to appear. */
const FLOW_START_GRACE_MS = 4_000;
/** How long a fresh sign-in may wait for the plan before the try-on ends. */
const SIGNED_IN_PLAN_WAIT_MS = 15_000;

export type ProLooksPopover = {
  readonly look: ProLook;
  /** "checking" while the plan is still loading: no try-on and no action yet. */
  readonly mode: "locked" | "checking";
};

export type ProLooksControllerInput = {
  readonly access: ProLooksAccess;
  /** macOS only: the Dock icon picker and its preview. */
  readonly appIconsSupported: boolean;
  readonly coat: PetModeCoat;
  readonly setCoat: (coat: PetModeCoat) => void;
  /** The saved accent color (a hex); unset means the built-in Moss. */
  readonly accent?: string;
  /** Saves an accent; null clears it back to Moss. */
  readonly setAccent?: (accent: string | null) => void;
  /** Sign-in, the Pro sheet, a trial start or a checkout is on screen or in progress. */
  readonly flowOpen: boolean;
  readonly requestSignIn: () => void;
  readonly startTrial: () => Promise<unknown>;
  readonly openProSheet: (look: ProLook) => void;
  readonly openAccountSettings: () => void;
};

export type ProLooksController = {
  readonly access: ProLooksAccess;
  readonly appIconsSupported: boolean;
  /** The saved Dock icon; null until it has been read. */
  readonly appIcon: AppIconVariantId | null;
  readonly appIconFailure: { readonly reason: unknown } | null;
  readonly coat: PetModeCoat;
  /** A coat in use before coats were locked; it stays open. */
  readonly keptCoat: PetModeCoat | null;
  /** The accent in use as an accent look id (a lowercase hex; Moss when unset). */
  readonly accent: string;
  /** An accent in use before accents were locked; it stays open. */
  readonly keptAccent: string | null;
  readonly popover: ProLooksPopover | null;
  /** The look tried on in the Dock, on the desktop pet or across the app right now. */
  readonly preview: ProLook | null;
  /** Looks put away when Pro ended, brought back when Pro starts again. */
  readonly reverted: RevertedLooks | null;
  /** Which picker's unlock could not start the trial. */
  readonly trialStartFailed: ProLook["kind"] | null;
  /** The look an unlock applied once Pro arrived, for the Pro-started notice to name. */
  readonly unlockedLook: ProLook | null;
  readonly isLocked: (look: ProLook) => boolean;
  readonly pick: (look: ProLook) => void;
  readonly closePopover: () => void;
  readonly unlock: () => void;
  readonly unlockReverted: (kind: ProLook["kind"]) => void;
  readonly forgetUnlockedLook: () => void;
};

/**
 * Pro looks on one device: which icons, coats and accents are locked, the
 * try-on that a locked pick starts (the Dock icon, the desktop pet or the app's
 * accent actually changes while its bubble is open), the unlock flow behind the
 * bubble's button, and putting Pro looks away when Pro ends. A try-on is never
 * saved: closing the bubble, leaving the page, abandoning the flow or quitting
 * puts the saved look back.
 */
export function useProLooksController(input: ProLooksControllerInput): ProLooksController {
  const { access, appIconsSupported, coat, setCoat, flowOpen } = input;
  const accent = accentLookId(input.accent);
  const latest = useRef(input);
  latest.current = input;

  const [appIcon, setAppIcon] = useState<AppIconVariantId | null>(null);
  const [iconSaving, setIconSaving] = useState(false);
  const [appIconFailure, setAppIconFailure] = useState<{ reason: unknown } | null>(null);
  const [keptCoat] = useState(() => resolveKeptCoat());
  const [keptAccent] = useState(() => resolveKeptAccent(input.accent));
  const [popover, setPopover] = useState<ProLooksPopover | null>(null);
  const [preview, setPreview] = useState<ProLook | null>(null);
  const [pending, setPending] = useState<ProLook | null>(null);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const [trialStartFailed, setTrialStartFailed] = useState<ProLook["kind"] | null>(null);
  const [unlockedLook, setUnlockedLook] = useState<ProLook | null>(null);
  const [reverted, setRevertedState] = useState<RevertedLooks | null>(() => readRevertedLooks());
  const revertedRef = useRef(reverted);
  const iconRequest = useRef(0);
  const sawFlow = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const setReverted = useCallback((next: RevertedLooks | null) => {
    const value = next && (next.icon || next.coat || next.accent) ? next : null;
    revertedRef.current = value;
    writeRevertedLooks(value);
    setRevertedState(value);
  }, []);

  // A try-on never survives a relaunch, even after a crash.
  useEffect(() => {
    writePetCoatPreview(null);
  }, []);

  useEffect(() => {
    if (!appIconsSupported) return;
    let cancelled = false;
    getAppIconVariant()
      .catch(() => DEFAULT_APP_ICON_VARIANT)
      .then((saved) => {
        if (!cancelled) setAppIcon((current) => current ?? saved);
      });
    return () => {
      cancelled = true;
    };
  }, [appIconsSupported]);

  const forgetReverted = useCallback((kind: ProLook["kind"], expected: string | undefined) => {
    const current = revertedRef.current;
    if (current?.[kind] && current[kind] === expected) setReverted({ ...current, [kind]: undefined });
  }, [setReverted]);

  const saveAppIcon = useCallback((variant: AppIconVariantId, previous: AppIconVariantId | null, onSaved?: () => void) => {
    const request = ++iconRequest.current;
    setIconSaving(true);
    setAppIcon(variant);
    setAppIconFailure(null);
    void setAppIconVariant(variant).then((saved) => {
      if (request !== iconRequest.current) return;
      setAppIcon(saved);
      setIconSaving(false);
      onSaved?.();
    }).catch(async (reason: unknown) => {
      if (request !== iconRequest.current) return;
      // IPC can fail after the native preference was written. Read the saved
      // value before rolling the picker back, and ignore superseded replies.
      const saved = await getAppIconVariant().catch(() => previous);
      if (request !== iconRequest.current) return;
      setAppIcon(saved);
      setIconSaving(false);
      setAppIconFailure({ reason });
    });
  }, []);

  const isLocked = useCallback(
    (look: ProLook) => isLookLocked(look, { access, currentIcon: appIcon, currentCoat: coat, keptCoat, currentAccent: accent, keptAccent }),
    [access, accent, appIcon, coat, keptAccent, keptCoat],
  );

  const isInUse = useCallback(
    (look: ProLook) => {
      switch (look.kind) {
        case "icon": return look.id === appIcon;
        case "coat": return look.id === coat || look.id === keptCoat;
        case "accent": return look.id === accent || look.id === keptAccent;
      }
    },
    [accent, appIcon, coat, keptAccent, keptCoat],
  );

  const apply = useCallback((look: ProLook) => {
    const remembered = revertedRef.current?.[look.kind];
    if (look.kind === "icon") {
      // A failed save must keep the remembered choice. A later explicit pick
      // is also the retry path after an automatic save failed.
      if (look.id !== appIcon || appIconFailure) {
        saveAppIcon(look.id, appIcon, () => forgetReverted("icon", remembered));
      } else if (!iconSaving) forgetReverted("icon", remembered);
    } else if (look.kind === "accent") {
      // "More colors" has no color of its own; once open, its picker saves one.
      if (look.id === CUSTOM_ACCENT) return;
      if (look.id !== accent) latest.current.setAccent?.(look.id === DEFAULT_ACCENT ? null : look.id);
      forgetReverted("accent", remembered);
    } else {
      if (look.id !== coat) setCoat(look.id);
      forgetReverted("coat", remembered);
    }
  }, [accent, appIcon, appIconFailure, coat, forgetReverted, iconSaving, saveAppIcon, setCoat]);

  const endFlow = useCallback(() => {
    setPending(null);
    setPreview(null);
    setAwaitingSignIn(false);
  }, []);

  const runTrial = useCallback((look: ProLook) => {
    latest.current.startTrial().catch(() => {
      setTrialStartFailed(look.kind);
      endFlow();
    });
  }, [endFlow]);

  const startFlow = useCallback((look: ProLook) => {
    sawFlow.current = false;
    setTrialStartFailed(null);
    setPending(look);
    switch (access.state) {
      case "guest":
        setAwaitingSignIn(true);
        latest.current.requestSignIn();
        return;
      case "trial-available":
        runTrial(look);
        return;
      case "upgrade":
        latest.current.openProSheet(look);
        return;
      case "unavailable":
        latest.current.openAccountSettings();
        endFlow();
        return;
      default:
        endFlow();
    }
  }, [access.state, endFlow, runTrial]);

  const pick = useCallback((look: ProLook) => {
    setTrialStartFailed(null);
    if (isProLook(look) && access.state === "unknown" && !isInUse(look)) {
      setPopover({ look, mode: "checking" });
      if (!pendingRef.current) setPreview(null);
      return;
    }
    if (!isLocked(look)) {
      setPopover(null);
      if (!pendingRef.current) setPreview(null);
      apply(look);
      return;
    }
    setPopover({ look, mode: "locked" });
    if (!pendingRef.current) setPreview(canTryOn(look) ? look : null);
  }, [access.state, apply, isInUse, isLocked]);

  const closePopover = useCallback(() => {
    setPopover(null);
    if (!pendingRef.current) setPreview(null);
  }, []);

  const unlock = useCallback(() => {
    if (!popover || popover.mode !== "locked") return;
    setPopover(null);
    startFlow(popover.look);
  }, [popover, startFlow]);

  const unlockReverted = useCallback((kind: ProLook["kind"]) => {
    let look: ProLook | null = null;
    if (kind === "icon" && reverted?.icon) look = { kind: "icon", id: reverted.icon };
    else if (kind === "coat" && reverted?.coat) look = { kind: "coat", id: reverted.coat };
    else if (kind === "accent" && reverted?.accent) look = { kind: "accent", id: reverted.accent };
    if (!look) return;
    setPopover(null);
    setPreview(null);
    startFlow(look);
  }, [reverted, startFlow]);

  // A bubble opened while the plan was loading turns into the real answer.
  useEffect(() => {
    if (popover?.mode !== "checking" || access.state === "unknown") return;
    const look = popover.look;
    if (isLocked(look)) {
      setPopover({ look, mode: "locked" });
      if (!pendingRef.current) setPreview(canTryOn(look) ? look : null);
      return;
    }
    setPopover(null);
    apply(look);
  }, [access.state, apply, isLocked, popover]);

  // Pro arrived (a trial, a purchase or a seat): apply the look that waited for it.
  useEffect(() => {
    if (!pending || access.state !== "open") return;
    apply(pending);
    // "More colors" applied nothing, so the notice names no look for it.
    setUnlockedLook(canTryOn(pending) ? pending : null);
    setPopover(null);
    endFlow();
  }, [access.state, apply, endFlow, pending]);

  // After signing in, continue with whatever the account allows.
  useEffect(() => {
    if (!pending || !awaitingSignIn) return;
    if (access.state === "trial-available") {
      // The trial or sheet is a new step; give it the same grace to appear.
      sawFlow.current = false;
      setAwaitingSignIn(false);
      runTrial(pending);
    } else if (access.state === "upgrade") {
      sawFlow.current = false;
      setAwaitingSignIn(false);
      latest.current.openProSheet(pending);
    } else if (access.state === "unavailable") {
      latest.current.openAccountSettings();
      endFlow();
    }
  }, [access.state, awaitingSignIn, endFlow, pending, runTrial]);

  // A flow closed without Pro (sign-in dismissed, sheet set aside, trial
  // failed) ends the try-on, as does a flow that never got going.
  useEffect(() => {
    if (!pending) return;
    if (flowOpen) {
      sawFlow.current = true;
      return;
    }
    if (awaitingSignIn && access.state !== "guest") {
      const timer = window.setTimeout(endFlow, SIGNED_IN_PLAN_WAIT_MS);
      return () => window.clearTimeout(timer);
    }
    if (sawFlow.current) {
      endFlow();
      return;
    }
    const timer = window.setTimeout(endFlow, FLOW_START_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [access.state, awaitingSignIn, endFlow, flowOpen, pending]);

  // When Pro is known to have ended, Pro looks go back to the free defaults
  // quietly. They are remembered, so starting Pro again brings them back.
  useEffect(() => {
    if (pending || !isKnownWithoutPro(access)) return;
    const next: { icon?: AppIconVariantId; coat?: PetModeCoat; accent?: string } = { ...(reverted ?? {}) };
    let changed = false;
    if (appIconsSupported && appIcon !== null && !FREE_APP_ICONS.has(appIcon) && !iconSaving && !appIconFailure) {
      next.icon = appIcon;
      saveAppIcon(FREE_FALLBACK_APP_ICON, appIcon);
      changed = true;
    }
    if (!FREE_PET_COATS.has(coat) && coat !== keptCoat) {
      next.coat = coat;
      setCoat(FREE_FALLBACK_PET_COAT);
      changed = true;
    }
    const saveAccent = latest.current.setAccent;
    if (saveAccent && !FREE_ACCENTS.has(accent) && accent !== keptAccent) {
      next.accent = accent;
      saveAccent(null);
      changed = true;
    }
    if (changed) setReverted(next);
  }, [access, accent, appIcon, appIconFailure, appIconsSupported, coat, iconSaving, keptAccent, keptCoat, pending, reverted, saveAppIcon, setCoat, setReverted]);

  useEffect(() => {
    if (access.state !== "open" || !reverted) return;
    if (reverted.icon && appIconsSupported && appIcon !== null && !iconSaving && !appIconFailure) {
      const remembered = reverted.icon;
      if (appIcon === FREE_FALLBACK_APP_ICON) {
        saveAppIcon(remembered, appIcon, () => forgetReverted("icon", remembered));
      } else forgetReverted("icon", remembered);
    }
    if (reverted.coat) {
      if (coat === FREE_FALLBACK_PET_COAT) setCoat(reverted.coat);
      forgetReverted("coat", reverted.coat);
    }
    if (reverted.accent && latest.current.setAccent) {
      if (accent === DEFAULT_ACCENT) latest.current.setAccent(reverted.accent);
      forgetReverted("accent", reverted.accent);
    }
  }, [access.state, accent, appIcon, appIconFailure, appIconsSupported, coat, forgetReverted, iconSaving, reverted, saveAppIcon, setCoat]);

  // The try-on lasts while its bubble is open, or while the unlock it started
  // is still under way.
  const shownPreview = preview
    && ((popover?.mode === "locked" && sameLook(popover.look, preview)) || sameLook(pending, preview))
    ? preview
    : null;
  const shownIcon = shownPreview?.kind === "icon" ? shownPreview.id : null;
  const shownCoat = shownPreview?.kind === "coat" ? shownPreview.id : null;
  const dockPreviewActive = useRef(false);
  useEffect(() => {
    if (!appIconsSupported) return;
    if (shownIcon) {
      dockPreviewActive.current = true;
      void previewAppIcon(shownIcon).catch(() => undefined);
      return;
    }
    if (!dockPreviewActive.current) return;
    dockPreviewActive.current = false;
    void previewAppIcon(null).catch(() => undefined);
  }, [appIconsSupported, shownIcon]);
  useEffect(() => {
    writePetCoatPreview(shownCoat);
  }, [shownCoat]);

  return {
    access,
    appIconsSupported,
    appIcon,
    appIconFailure,
    coat,
    keptCoat,
    accent,
    keptAccent,
    popover,
    preview: shownPreview,
    reverted,
    trialStartFailed,
    unlockedLook,
    isLocked,
    pick,
    closePopover,
    unlock,
    unlockReverted,
    forgetUnlockedLook: useCallback(() => setUnlockedLook(null), []),
  };
}

const ProLooksContext = createContext<ProLooksController | null>(null);

/** "More colors" opens a picker rather than a color, so it has nothing to try on. */
function canTryOn(look: ProLook): boolean {
  return !(look.kind === "accent" && look.id === CUSTOM_ACCENT);
}

export const ProLooksProvider = ProLooksContext.Provider;

/** Null outside the app shell (isolated component tests), where nothing is locked. */
export function useProLooks(): ProLooksController | null {
  return useContext(ProLooksContext);
}

