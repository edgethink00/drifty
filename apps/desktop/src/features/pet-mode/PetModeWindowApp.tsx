import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { PetModeCat, type PetModeCatPhase, type PetModeDragPose } from "./PetModeCat";
import {
  alignNativePetContact,
  cancelNativePetMotion,
  exitNativePetScreen,
  listenToNativePetModeEvent,
  listenToNativePetModeLabStateRequest,
  moveNativePetToTarget,
  rememberNativePetPosition,
  reportNativePetContact,
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
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_FPS,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  getPetModeLifeActionInterval,
  type PetModeInterventionTarget,
  type PetModeLabAction,
  type PetModePreviewAction,
  type PetModeSnapshot,
} from "./petModeData";
import "./petMode.css";

const LIFE_ACTIONS = ["walk", "stretch", "sleep"] as const;
const LAB_LIFE_ACTIONS = ["walk", "stretch", "tail_flick"] as const;
type LifeAction = PetModePreviewAction;

export function PetModeWindowApp() {
  const [phase, setPhase] = useState<PetModeCatPhase>("idle");
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [pawFrame, setPawFrame] = useState(0);
  const [dragPose, setDragPose] = useState<PetModeDragPose>("a");
  const [snapshot, setSnapshot] = useState<PetModeSnapshot | null>(null);
  const [labLifeLoopEnabled, setLabLifeLoopEnabled] = useState(false);
  const actionTokenRef = useRef(0);
  const phaseRef = useRef<PetModeCatPhase>("idle");
  const activeLabActionRef = useRef<PetModeLabAction | null>(null);
  const labLifeLoopEnabledRef = useRef(false);
  const visibleRef = useRef(true);
  const sleepTouchRef = useRef(0);
  const manualDragRef = useRef(false);
  const nextDragPoseRef = useRef<PetModeDragPose>("a");
  const rememberPositionTimerRef = useRef(0);
  const dragSettleTimerRef = useRef(0);
  const pointerPressRef = useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
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
    if (!manualDragRef.current && phaseRef.current !== "drag") return;
    manualDragRef.current = false;
    window.clearTimeout(rememberPositionTimerRef.current);
    window.clearTimeout(dragSettleTimerRef.current);

    if (prefersReducedMotion()) {
      commitPhase("idle");
    } else {
      commitPhase("settle");
      dragSettleTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === "settle") commitPhase("idle");
      }, PET_MODE_DRAG_SETTLE_MS);
    }

    if (rememberPosition) {
      // Native dragging has already committed the window's final position by
      // pointer-up. Persist it directly instead of waiting for another move
      // event that may never arrive after a short drag.
      void rememberNativePetPosition().catch(() => undefined);
    }
  }, [commitPhase]);

  useEffect(() => {
    document.documentElement.dataset.surface = "pet-mode";
    return () => { delete document.documentElement.dataset.surface; };
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
    // A compact pet is its own input surface. Delaying this behind a native
    // hover poll leaves the first press click-through, which can activate the
    // dashboard below before the pet renderer gets a chance to consume it.
    void setNativePetInteractive(true).catch(() => undefined);
    return () => {
      void setNativePetInteractive(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const petWindow = getCurrentWindow();
    void petWindow.onMoved(() => {
      if (!manualDragRef.current) return;
      window.clearTimeout(rememberPositionTimerRef.current);
      rememberPositionTimerRef.current = window.setTimeout(() => {
        // Pointer capture normally finishes the drag. This is a native fallback
        // for the rare case where WebKit loses pointer-up during window move.
        finishManualDrag();
      }, 900);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
      window.clearTimeout(rememberPositionTimerRef.current);
      window.clearTimeout(dragSettleTimerRef.current);
    };
  }, [finishManualDrag]);

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
        if (manualDragRef.current || phaseRef.current === "drag" || phaseRef.current === "settle") return;
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
      if (manualDragRef.current || phaseRef.current === "drag" || phaseRef.current === "settle") {
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
    // Native dragging only starts once the pointer has genuinely moved.
    pointerPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const press = pointerPressRef.current;
    if (press && !press.dragging) {
      const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      if (distance >= 7) {
        press.dragging = true;
        const dragToken = ++actionTokenRef.current;
        sleepTouchRef.current = 0;
        manualDragRef.current = true;
        // `startDragging` enters the native macOS window-drag loop. If React's
        // update is still queued at that point, WebKit keeps compositing the
        // last idle/walk frame for the whole drag. Commit the scruff bitmap
        // synchronously, then leave enough time for one real browser paint
        // before handing control to AppKit.
        const selectedDragPose = nextDragPoseRef.current;
        nextDragPoseRef.current = selectedDragPose === "a" ? "b" : "a";
        flushSync(() => {
          setDragPose(selectedDragPose);
          commitPhase("drag");
        });
        window.clearTimeout(rememberPositionTimerRef.current);
        window.clearTimeout(dragSettleTimerRef.current);
        rememberPositionTimerRef.current = window.setTimeout(() => {
          finishManualDrag();
        }, 8_000);
        void (async () => {
          await cancelNativePetMotion().catch(() => undefined);
          await delay(34);
          if (
            !manualDragRef.current
            || phaseRef.current !== "drag"
            || actionTokenRef.current !== dragToken
          ) return;
          await getCurrentWindow().startDragging();
        })().catch(() => finishManualDrag(false));
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const press = pointerPressRef.current;
    pointerPressRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!press) return;
    if (press.dragging) {
      finishManualDrag();
      return;
    }
    handlePet();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const press = pointerPressRef.current;
    pointerPressRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (press?.dragging) finishManualDrag();
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
      <button
        ref={hitTargetRef}
        type="button"
        className="pet-mode-hit-target"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-label="Pet Drifty cat. Drag to move."
      >
        <PetModeCat phase={phase} facing={facing} pawFrame={pawFrame} dragPose={dragPose} />
        <span
          ref={contactAnchorRef}
          className={`pet-mode-contact-anchor pet-mode-contact-anchor--${facing}`}
          aria-hidden="true"
        />
      </button>
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
