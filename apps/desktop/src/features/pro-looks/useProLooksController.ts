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
  FREE_APP_ICONS,
  FREE_FALLBACK_APP_ICON,
  FREE_FALLBACK_PET_COAT,
  FREE_PET_COATS,
  isKnownWithoutPro,
  isLookLocked,
  isProLook,
  readRevertedLooks,
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
  readonly popover: ProLooksPopover | null;
  /** The look tried on in the Dock or on the desktop pet right now. */
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
 * Pro looks on one device: which icons and coats are locked, the try-on that a
 * locked pick starts (the Dock icon or the desktop pet actually changes while
 * its bubble is open), the unlock flow behind the bubble's button, and putting
 * Pro looks away when Pro ends. A try-on is never saved: closing the bubble,
 * leaving the page, abandoning the flow or quitting puts the saved look back.
 */
export function useProLooksController(input: ProLooksControllerInput): ProLooksController {
  const { access, appIconsSupported, coat, setCoat, flowOpen } = input;
  const latest = useRef(input);
  latest.current = input;

  const [appIcon, setAppIcon] = useState<AppIconVariantId | null>(null);
  const [appIconFailure, setAppIconFailure] = useState<{ reason: unknown } | null>(null);
  const [keptCoat] = useState(() => resolveKeptCoat());
  const [popover, setPopover] = useState<ProLooksPopover | null>(null);
  const [preview, setPreview] = useState<ProLook | null>(null);
  const [pending, setPending] = useState<ProLook | null>(null);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const [trialStartFailed, setTrialStartFailed] = useState<ProLook["kind"] | null>(null);
  const [unlockedLook, setUnlockedLook] = useState<ProLook | null>(null);
  const [reverted, setRevertedState] = useState<RevertedLooks | null>(() => readRevertedLooks());
  const iconRequest = useRef(0);
  const sawFlow = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const setReverted = useCallback((next: RevertedLooks | null) => {
    const value = next && (next.icon || next.coat) ? next : null;
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

  const saveAppIcon = useCallback((variant: AppIconVariantId, previous: AppIconVariantId | null) => {
    const request = ++iconRequest.current;
    setAppIcon(variant);
    setAppIconFailure(null);
    setAppIconVariant(variant).catch((reason: unknown) => {
      if (request !== iconRequest.current) return;
      setAppIcon(previous);
      setAppIconFailure({ reason });
    });
  }, []);

  const isLocked = useCallback(
    (look: ProLook) => isLookLocked(look, { access, currentIcon: appIcon, currentCoat: coat, keptCoat }),
    [access, appIcon, coat, keptCoat],
  );

  const isInUse = useCallback(
    (look: ProLook) => (look.kind === "icon" ? look.id === appIcon : look.id === coat || look.id === keptCoat),
    [appIcon, coat, keptCoat],
  );

  const apply = useCallback((look: ProLook) => {
    if (look.kind === "icon") {
      if (look.id !== appIcon) saveAppIcon(look.id, appIcon);
    } else if (look.id !== coat) {
      setCoat(look.id);
    }
    // A look chosen now replaces whatever the end of Pro put away.
    if (reverted?.[look.kind]) setReverted({ ...reverted, [look.kind]: undefined });
  }, [appIcon, coat, reverted, saveAppIcon, setCoat, setReverted]);

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
    if (!pendingRef.current) setPreview(look);
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
    const look: ProLook | null = kind === "icon"
      ? (reverted?.icon ? { kind: "icon", id: reverted.icon } : null)
      : (reverted?.coat ? { kind: "coat", id: reverted.coat } : null);
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
      if (!pendingRef.current) setPreview(look);
      return;
    }
    setPopover(null);
    apply(look);
  }, [access.state, apply, isLocked, popover]);

  // Pro arrived (a trial, a purchase or a seat): apply the look that waited for it.
  useEffect(() => {
    if (!pending || access.state !== "open") return;
    apply(pending);
    setUnlockedLook(pending);
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
    const next: { icon?: AppIconVariantId; coat?: PetModeCoat } = { ...(reverted ?? {}) };
    let changed = false;
    if (appIconsSupported && appIcon !== null && !FREE_APP_ICONS.has(appIcon)) {
      next.icon = appIcon;
      saveAppIcon(FREE_FALLBACK_APP_ICON, appIcon);
      changed = true;
    }
    if (!FREE_PET_COATS.has(coat) && coat !== keptCoat) {
      next.coat = coat;
      setCoat(FREE_FALLBACK_PET_COAT);
      changed = true;
    }
    if (changed) setReverted(next);
  }, [access, appIcon, appIconsSupported, coat, keptCoat, pending, reverted, saveAppIcon, setCoat, setReverted]);

  useEffect(() => {
    if (access.state !== "open" || !reverted) return;
    if (reverted.icon && appIconsSupported) {
      if (appIcon === null) return;
      if (appIcon === FREE_FALLBACK_APP_ICON) saveAppIcon(reverted.icon, appIcon);
    }
    if (reverted.coat && coat === FREE_FALLBACK_PET_COAT) setCoat(reverted.coat);
    setReverted(null);
  }, [access.state, appIcon, appIconsSupported, coat, reverted, saveAppIcon, setCoat, setReverted]);

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

export const ProLooksProvider = ProLooksContext.Provider;

/** Null outside the app shell (isolated component tests), where nothing is locked. */
export function useProLooks(): ProLooksController | null {
  return useContext(ProLooksContext);
}

