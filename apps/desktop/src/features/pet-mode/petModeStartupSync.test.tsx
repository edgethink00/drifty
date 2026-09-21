// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRef } from "react";

describe("petModeStartupSync logic", () => {
  it("treats the initial startup as a forceReveal request when pet is active, then transitions to manual revisions", () => {
    const { result } = renderHook(() => {
      const initialPetModeSyncCompletedRef = useRef(false);
      const handledPetModeRevealRevisionRef = useRef(0);
      const pendingPetModeRevealRevisionsRef = useRef(new Set<number>());

      const evaluateForceReveal = (petModeActive: boolean, revealRevision: number) => {
        const isInitialStartupSync = !initialPetModeSyncCompletedRef.current;
        const forceReveal = petModeActive
          && (isInitialStartupSync
            || (revealRevision > handledPetModeRevealRevisionRef.current
              && !pendingPetModeRevealRevisionsRef.current.has(revealRevision)));
        return { forceReveal, isInitialStartupSync };
      };

      const markSyncComplete = () => {
        initialPetModeSyncCompletedRef.current = true;
      };

      const markSyncFailed = () => {
        initialPetModeSyncCompletedRef.current = false;
      };

      return { evaluateForceReveal, markSyncComplete, markSyncFailed };
    });

    // 1. Initial startup sync with petModeActive=true and revealRevision=0:
    // Previously forceReveal was false, which caused silent failure.
    // Now forceReveal is true.
    const firstEval = result.current.evaluateForceReveal(true, 0);
    expect(firstEval.isInitialStartupSync).toBe(true);
    expect(firstEval.forceReveal).toBe(true);

    // If sync fails on startup, isInitialStartupSync remains true for retry
    result.current.markSyncFailed();
    const retryEval = result.current.evaluateForceReveal(true, 0);
    expect(retryEval.isInitialStartupSync).toBe(true);
    expect(retryEval.forceReveal).toBe(true);

    // When sync completes successfully
    result.current.markSyncComplete();

    // Subsequent render without manual click (revealRevision still 0) does not re-force reveal
    const normalEval = result.current.evaluateForceReveal(true, 0);
    expect(normalEval.isInitialStartupSync).toBe(false);
    expect(normalEval.forceReveal).toBe(false);

    // When user manually toggles (revealRevision becomes 1)
    const manualEval = result.current.evaluateForceReveal(true, 1);
    expect(manualEval.isInitialStartupSync).toBe(false);
    expect(manualEval.forceReveal).toBe(true);
  });

  it("does not consume the initial startup reveal when the first sync runs before pet mode is active", () => {
    const { result } = renderHook(() => {
      const initialPetModeSyncCompletedRef = useRef(false);
      const handledPetModeRevealRevisionRef = useRef(0);
      const pendingPetModeRevealRevisionsRef = useRef(new Set<number>());

      const evaluateForceReveal = (petModeActive: boolean, revealRevision: number) => {
        const isInitialStartupSync = !initialPetModeSyncCompletedRef.current;
        const forceReveal = petModeActive
          && (isInitialStartupSync
            || (revealRevision > handledPetModeRevealRevisionRef.current
              && !pendingPetModeRevealRevisionsRef.current.has(revealRevision)));
        return { forceReveal, isInitialStartupSync };
      };

      const markSyncComplete = (petModeActive: boolean) => {
        if (petModeActive) {
          initialPetModeSyncCompletedRef.current = true;
        }
      };

      return { evaluateForceReveal, markSyncComplete };
    });

    const beforeStorage = result.current.evaluateForceReveal(false, 0);
    expect(beforeStorage.isInitialStartupSync).toBe(true);
    expect(beforeStorage.forceReveal).toBe(false);
    result.current.markSyncComplete(false);

    const afterStorage = result.current.evaluateForceReveal(true, 0);
    expect(afterStorage.isInitialStartupSync).toBe(true);
    expect(afterStorage.forceReveal).toBe(true);
  });
});
