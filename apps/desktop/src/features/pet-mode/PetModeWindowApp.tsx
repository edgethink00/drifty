import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { PetModeCat, type PetModeCatPhase } from "./PetModeCat";
import {
  alignNativePetContact,
  beginNativePetDrag,
  cancelNativePetMotion,
  exitNativePetScreen,
  listenToNativePetDragEnd,
  listenToNativePetDragStart,
  listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest,
  moveNativePetToTarget,
  rememberNativePetPosition,
  reportNativePetContact,
  reportNativePetDragError,
  reportNativePetModeLabState,
  reportNativePetPointer,
  returnNativePetFromOuting,
  returnNativePetHome,
  roamNativePet,
  setNativePetPresence,
  setNativePetInteractive,
} from "./petModeBridge";
import {
  PET_MODE_AWAY_MS,
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_BLINK_INTERVAL_MAX_MS,
  PET_MODE_BLINK_INTERVAL_MIN_MS,
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_FPS,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  getPetModeLifeActionInterval,
  resolveInitialPetModeCoat,
  resolveInitialPetModeSize,
  type PetModeInterventionTarget,
  type PetModeLabAction,
  type PetModePreviewAction,
  type PetModeSnapshot,
  type PetModeCoat,
  type PetModeSize,
} from "./petModeData";
import "./petMode.css";

const LIFE_ACTIONS = ["walk", "stretch", "sleep"] as const;
const LAB_LIFE_ACTIONS = ["walk", "stretch", "tail_flick"] as const;
type LifeAction = PetModePreviewAction;

export function PetModeWindowApp() {
  const [phase, setPhase] = useState<PetModeCatPhase>("idle");
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [pawFrame, setPawFrame] = useState(0);
  const [snapshot, setSnapshot] = useState<PetModeSnapshot | null>(null);
  const [labLifeLoopEnabled, setLabLifeLoopEnabled] = useState(false);
  const actionTokenRef = useRef(0);
  const phaseRef = useRef<PetModeCatPhase>("idle");
  const activeLabActionRef = useRef<PetModeLabAction | null>(null);
  const labLifeLoopEnabledRef = useRef(false);
  const visibleRef = useRef(true);
  const sleepTouchRef = useRef(0);
  const manualDragRef = useRef(false);
  const hitTargetRef = useRef<HTMLButtonElement | null>(null);
  const contactAnchorRef = useRef<HTMLSpanElement | null>(null);

  const reportLabState = useCallback((nextPhase = phaseRef.current) => {
    void reportNativePetModeLabState({
      phase: nextPhase,
      activeAction: activeLabActionRef.current,
      lifeLoopEnabled: labLifeLoopEnabledRef.current,
    }).catch(() => undefined);
  }, []);

  const commitPhase = useCallback((nextPhase: PetModeCatPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    reportLabState(nextPhase);
  }, [reportLabState]);

  const setActiveLabAction = useCallback((action: PetModeLabAction | null) => {
    activeLabActionRef.current = action;
    reportLabState();
  }, [reportLabState]);

  const setLifeLoopEnabled = useCallback((enabled: boolean) => {
    labLifeLoopEnabledRef.current = enabled;
    setLabLifeLoopEnabled(enabled);
    reportLabState();
  }, [reportLabState]);

  const finishManualDrag = useCallback((rememberPosition = true) => {
    if (
      !manualDragRef.current
      && phaseRef.current !== "drag"
    ) return;
    manualDragRef.current = false;
    const releaseToken = ++actionTokenRef.current;

    void (async () => {
      if (!prefersReducedMotion()) {
        flushSync(() => commitPhase("release"));
        await delay(PET_MODE_DRAG_SETTLE_MS);
        if (releaseToken !== actionTokenRef.current) return;
      }

      if (releaseToken === actionTokenRef.current) commitPhase("idle");
      if (rememberPosition) {
        // Position persistence is bookkeeping, not part of the visual handoff.
        // Never strand the cat in the held/release silhouette while a native
        // monitor query or mutex is delayed.
        void rememberNativePetPosition().catch((error) => {
          void reportNativePetDragError(error).catch(() => undefined);
        });
      }
    })();
  }, [commitPhase]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragStart(() => {
      if (!manualDragRef.current || phaseRef.current === "drag") return;
      sleepTouchRef.current = 0;
      flushSync(() => commitPhase("drag"));
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [commitPhase]);

  useEffect(() => {
    document.documentElement.dataset.surface = "pet-mode";
    return () => { delete document.documentElement.dataset.surface; };
  }, []);

  // The pet runs in its own webview, so it cannot read the settings hook that
  // owns the toggle. Both webviews share localStorage, and `storage` fires in
  // every *other* document, which is exactly the cross-window direction needed
  // here. Applying the coat as a `data-` attribute means the swap is a pure
  // style recalculation: no remount, no `src` change, no animation restart.
  useEffect(() => {
    const applyCoat = (coat: PetModeCoat) => {
      document.documentElement.dataset.petCoat = coat;
    };
    applyCoat(resolveInitialPetModeCoat());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_COAT_STORAGE_KEY) return;
      applyCoat(resolveInitialPetModeCoat());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      delete document.documentElement.dataset.petCoat;
    };
  }, []);

  // Size arrives the same way the coat does. The webview only scales its own
  // drawing; the main window owns resizing the native panel, so both sides
  // read the same stored value rather than messaging each other.
  useEffect(() => {
    const applySize = (size: PetModeSize) => {
      document.documentElement.style.setProperty("--pet-size-scale", String(size / 100));
    };
    applySize(resolveInitialPetModeSize());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PET_MODE_SIZE_STORAGE_KEY) return;
      applySize(resolveInitialPetModeSize());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.documentElement.style.removeProperty("--pet-size-scale");
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    reportLabState();
    void listenToNativePetModeLabStateRequest(reportLabState).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [reportLabState]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetDragEnd((result) => {
      if (!result.moved) return;
      // The native tracker is the authority for mouse-up. Depending only on
      // the invoke promise can leave WebKit in `drag` after the native loop has
      // already released, especially when the panel crosses app/display
      // boundaries. The event arrives directly from that loop's completion.
      finishManualDrag();
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [finishManualDrag]);

  useEffect(() => {
    // A compact pet is its own input surface. Delaying this behind a native
    // hover poll leaves the first press click-through, which can activate the
    // dashboard below before the pet renderer gets a chance to consume it.
    // Do not disable input in this effect's cleanup: during Vite HMR, an old
    // mount can finish that async cleanup after the replacement mount has
    // enabled input and leave the still-visible panel click-through. Native
    // presence/enable commands already disable input whenever the panel hides.
    void setNativePetInteractive(true).catch(() => undefined);
  }, []);

  const revealForAction = useCallback(async () => {
    if (visibleRef.current) return;
    visibleRef.current = true;
    await setNativePetPresence(true);
  }, []);

  const playIntervention = useCallback(async (target: PetModeInterventionTarget) => {
    const token = ++actionTokenRef.current;
    let movedToTarget = false;

    try {
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      commitPhase("run");
      const resolved = await moveNativePetToTarget(target);
      if (token !== actionTokenRef.current) return;
      if (resolved.targetKind === "fallback" && !target.preview) {
        commitPhase("idle");
        await reportNativePetContact(target.id, false);
        return;
      }
      movedToTarget = true;
      setFacing(resolved.facing);
      setPawFrame(0);
      commitPhase("paw");

      const reducedMotion = prefersReducedMotion();
      const unitMilliseconds = reducedMotion ? 8 : 1000 / PET_MODE_PAW_FPS;
      let contacted = false;
      for (const step of PET_MODE_PAW_TIMELINE) {
        if (token !== actionTokenRef.current) return;
        if (!contacted && step.frame === PET_MODE_PAW_CONTACT_FRAME) {
          const hitTargetRect = hitTargetRef.current?.getBoundingClientRect();
          const anchorRect = contactAnchorRef.current?.getBoundingClientRect();
          if (hitTargetRect && anchorRect) {
            await alignNativePetContact({
              targetX: resolved.targetX,
              targetY: resolved.targetY,
              anchorX: anchorRect.left - hitTargetRect.left,
              anchorY: anchorRect.top - hitTargetRect.top,
              diagnostic: resolved.diagnostic,
            }).catch(() => undefined);
          }
          if (token !== actionTokenRef.current) return;
        }
        setPawFrame(step.frame);
        if (!contacted && step.frame === PET_MODE_PAW_CONTACT_FRAME) {
          contacted = true;
          // Let React commit and the WebView paint the exact contact silhouette
          // before the native target disappears.
          if (!reducedMotion) await delay(34);
          await reportNativePetContact(target.id).catch(() => undefined);
        }
        await delay(step.durationUnits * unitMilliseconds);
      }

      if (token !== actionTokenRef.current) return;
    } finally {
      if (token !== actionTokenRef.current) return;
      if (movedToTarget) {
        commitPhase("walk");
        await returnNativePetHome();
      }
      if (token === actionTokenRef.current) commitPhase("idle");
    }
  }, [commitPhase, revealForAction]);

  const playOuting = useCallback(async (awayMilliseconds: number) => {
    const token = ++actionTokenRef.current;
    try {
      await revealForAction();
      if (token !== actionTokenRef.current) return;
      commitPhase("walk");
      const exitSide = await exitNativePetScreen();
      if (token !== actionTokenRef.current) return;
      visibleRef.current = false;
      await setNativePetPresence(false);
      await delay(awayMilliseconds);
      if (token !== actionTokenRef.current) return;
      visibleRef.current = true;
      commitPhase("walk");
      await returnNativePetFromOuting(exitSide);
    } finally {
      if (token === actionTokenRef.current && visibleRef.current) commitPhase("idle");
    }
  }, [commitPhase, revealForAction]);

  const playLifeAction = useCallback(async (action: LifeAction, preview = true) => {
    if (action === "stop") {
      actionTokenRef.current += 1;
      sleepTouchRef.current = 0;
      setLifeLoopEnabled(false);
      visibleRef.current = true;
      commitPhase("idle");
      return;
    }
    if (action === "life_loop") {
      setLifeLoopEnabled(true);
      return;
    }
    if (action === "outing") {
      await playOuting(preview ? 2_600 : PET_MODE_AWAY_MS);
      return;
    }

    const token = ++actionTokenRef.current;
    await revealForAction();
    if (token !== actionTokenRef.current) return;
    sleepTouchRef.current = 0;

    if (action === "wake") {
      commitPhase("idle");
      return;
    }
    if (action === "sleep") {
      commitPhase("sleep");
      if (preview) return;
      await delay(randomBetween(2.5, 7.5) * 60_000);
    } else if (action === "walk") {
      commitPhase("walk");
      await roamNativePet();
    } else {
      const phaseByAction: Record<Exclude<LifeAction, "outing" | "wake" | "sleep" | "walk" | "stop" | "life_loop">, PetModeCatPhase> = {
        blink: "blink",
        stretch: "stretch",
        tail_flick: "tail",
        pet: "happy",
      };
      const durationByAction: Record<keyof typeof phaseByAction, number> = {
        blink: PET_MODE_BLINK_DURATION_MS,
        stretch: PET_MODE_LIFE_MOTION_DURATION_MS,
        tail_flick: PET_MODE_TAIL_FLICK_DURATION_MS,
        pet: 1_200,
      };
      commitPhase(phaseByAction[action]);
      await delay(prefersReducedMotion() ? 40 : durationByAction[action]);
    }

    if (token === actionTokenRef.current) commitPhase("idle");
  }, [commitPhase, playOuting, revealForAction, setLifeLoopEnabled]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetModeEvent((event) => {
      if (event.kind === "snapshot") {
        setSnapshot(event.snapshot);
        return;
      }
      if (event.kind === "facing") {
        setFacing(event.facing);
        return;
      }
      if (event.kind === "motion") {
        if (
          manualDragRef.current
          || phaseRef.current === "drag"
          || phaseRef.current === "release"
        ) return;
        commitPhase(event.motion);
        return;
      }
      if (event.kind === "preview_action") {
        // Lab previews are deliberately single-flight. A walk moves the native
        // overlay independently, so letting another pose start during that trip
        // makes the cat look as if it is stretching or sleeping while walking.
        // Wake is the one intentional interruption: it clears the persistent
        // sleep pose immediately.
        if (phaseRef.current !== "idle" && event.action !== "wake" && event.action !== "stop") {
          reportLabState();
          return;
        }
        void (async () => {
          setActiveLabAction(event.action);
          try {
            await playLifeAction(event.action);
          } catch {
            commitPhase("idle");
          } finally {
            setActiveLabAction(null);
          }
        })();
        return;
      }
      if (
        manualDragRef.current
        || phaseRef.current === "drag"
        || phaseRef.current === "release"
      ) {
        reportLabState();
        return;
      }
      void (async () => {
        setActiveLabAction("intervention");
        try {
          await playIntervention(event.target);
        } catch {
          commitPhase("idle");
          void returnNativePetHome().catch(() => undefined);
        } finally {
          setActiveLabAction(null);
        }
      })();
    }).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
      actionTokenRef.current += 1;
    };
  }, [commitPhase, playIntervention, playLifeAction, reportLabState, setActiveLabAction]);

  useEffect(() => {
    if (!labLifeLoopEnabled) return;
    let disposed = false;
    let timerId = 0;
    const schedule = (delayMs: number) => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current !== "idle" || !visibleRef.current) {
          schedule(700);
          return;
        }
        const action = LAB_LIFE_ACTIONS[Math.floor(Math.random() * LAB_LIFE_ACTIONS.length)];
        void playLifeAction(action).finally(() => {
          if (!disposed) schedule(randomBetween(8_000, 14_000));
        });
      }, delayMs);
    };
    schedule(350);
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [labLifeLoopEnabled, playLifeAction]);

  useEffect(() => {
    let disposed = false;
    let timerId = 0;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current !== "idle" || !visibleRef.current) {
          timerId = window.setTimeout(schedule, 1_000);
          return;
        }
        void playOuting(PET_MODE_AWAY_MS).finally(() => {
          if (!disposed) schedule();
        });
      }, PET_MODE_PRESENT_MS);
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [playOuting]);

  useEffect(() => {
    let disposed = false;
    let timerId = 0;
    const schedule = () => {
      const interval = getPetModeLifeActionInterval(snapshot?.productivity ?? null);
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current !== "idle" || !visibleRef.current) {
          timerId = window.setTimeout(schedule, 1_000);
          return;
        }
        const action = LIFE_ACTIONS[Math.floor(Math.random() * LIFE_ACTIONS.length)];
        void playLifeAction(action, false).finally(() => {
          if (!disposed) schedule();
        });
      }, randomBetween(.72, 1.28) * interval);
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [playLifeAction, snapshot?.productivity]);

  useEffect(() => {
    let disposed = false;
    let resetTimerId = 0;
    let timerId = 0;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (phaseRef.current === "idle" && visibleRef.current) {
          commitPhase("blink");
          resetTimerId = window.setTimeout(() => {
            if (phaseRef.current === "blink") commitPhase("idle");
          }, prefersReducedMotion() ? 30 : PET_MODE_BLINK_DURATION_MS);
        }
        schedule();
      }, randomBetween(PET_MODE_BLINK_INTERVAL_MIN_MS, PET_MODE_BLINK_INTERVAL_MAX_MS));
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.clearTimeout(resetTimerId);
    };
  }, [commitPhase]);

  useEffect(() => {
    let disposed = false;
    let resetTimerId = 0;
    let timerId = 0;
    const schedule = () => {
      timerId = window.setTimeout(() => {
        if (disposed) return;
        if (Math.random() < .34 && phaseRef.current === "idle" && visibleRef.current) {
          commitPhase("tail");
          resetTimerId = window.setTimeout(() => {
            if (phaseRef.current === "tail") commitPhase("idle");
          }, prefersReducedMotion() ? 40 : PET_MODE_TAIL_FLICK_DURATION_MS);
        }
        schedule();
      }, randomBetween(6_200, 10_400));
    };
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.clearTimeout(resetTimerId);
    };
  }, [commitPhase]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    // The overlay is a separate, non-focusable window. It must still consume
    // every press on its hit rectangle, including while an animation is busy;
    // otherwise macOS may forward that down-event to the dashboard below it.
    event.preventDefault();
    event.stopPropagation();
    void reportNativePetPointer().catch(() => undefined);
    if (typeof event.button === "number" && event.button > 0) return;
    if (manualDragRef.current) return;
    const dragToken = ++actionTokenRef.current;
    manualDragRef.current = true;
    void cancelNativePetMotion().catch(() => undefined);
    void (async () => {
      try {
        // Native tracking must begin in the original pointer-down task so it
        // preserves the exact initial cursor coordinate. Waiting here for the
        // pickup artwork made short/quick drags lose their first 148 ms and
        // appear as a tiny twitch. Rust owns that visual hold now: it captures
        // the pointer immediately, lets WebKit paint, then follows the full
        // delta without sacrificing input.
        const result = await beginNativePetDrag(
          event.clientX,
          event.clientY,
          prefersReducedMotion() ? 0 : PET_MODE_DRAG_PICKUP_MS,
        );
        // A real pointer drag owns the pet until release. Automatic/lab actions
        // may invalidate their own token while AppKit runs its native tracking
        // loop, but they must never strand manualDragRef at true or suppress the
        // user's release transition.
        if (result.moved) {
          finishManualDrag();
          return;
        }
        manualDragRef.current = false;
        // Native movement never crossed the drag threshold, so this entire
        // gesture is a normal petting tap. Cancel any interrupted life pose
        // before playing the existing happy reaction, while preserving the
        // deliberate two-touch wake behavior for a sleeping cat.
        if (phaseRef.current !== "sleep") commitPhase("idle");
        handlePet();
      } catch (error) {
        void reportNativePetDragError(error).catch(() => undefined);
        manualDragRef.current = false;
        if (dragToken === actionTokenRef.current) commitPhase("idle");
      }
    })();
  };

  const handlePet = () => {
    if (manualDragRef.current) return;
    if (phaseRef.current === "sleep") {
      if (sleepTouchRef.current === 0) {
        sleepTouchRef.current = 1;
        return;
      }
      void playLifeAction("wake");
      return;
    }
    if (phaseRef.current !== "idle" && phaseRef.current !== "blink" && phaseRef.current !== "tail") return;
    void playLifeAction("pet");
  };

  return (
    <main className="pet-mode-surface" data-productivity={snapshot?.productivity ?? "neutral"}>
      <div className="pet-mode-scale">
        <button
          ref={hitTargetRef}
          type="button"
          className="pet-mode-hit-target"
          onPointerDown={handlePointerDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-label="Pet Drifty cat. Drag to move."
        >
          <span
            className={`pet-mode-hit-shape${facing === "left" ? " is-mirrored" : ""}`}
            aria-hidden="true"
          />
          <PetModeCat phase={phase} facing={facing} pawFrame={pawFrame} />
          <span
            ref={contactAnchorRef}
            className={`pet-mode-contact-anchor pet-mode-contact-anchor--${facing}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </main>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
