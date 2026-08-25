import { useCallback, useEffect, useRef, useState } from "react";
import { PetModeCat, type PetModeCatPhase } from "../../pet-mode/PetModeCat";
import "../../pet-mode/petMode.css";

const HAPPY_DURATION_MS = 1_200;

export function OnboardingCatPreview({
  enabled,
  label,
  onEnable,
}: {
  readonly enabled: boolean;
  readonly label: string;
  readonly onEnable: () => void;
}) {
  const [phase, setPhase] = useState<PetModeCatPhase>("idle");
  const actionTokenRef = useRef(0);
  const happyTimeoutRef = useRef<number | null>(null);
  const skipToggleHappyRef = useRef(false);
  const enableLatchedRef = useRef(enabled);
  const didMountRef = useRef(false);

  const playHappy = useCallback(() => {
    if (prefersReducedMotion()) {
      setPhase("idle");
      return;
    }
    const token = ++actionTokenRef.current;
    setPhase("happy");
    if (happyTimeoutRef.current !== null) window.clearTimeout(happyTimeoutRef.current);
    happyTimeoutRef.current = window.setTimeout(() => {
      if (token !== actionTokenRef.current) return;
      setPhase("idle");
      happyTimeoutRef.current = null;
    }, HAPPY_DURATION_MS);
  }, []);

  useEffect(() => {
    const wasEnabled = enableLatchedRef.current;
    enableLatchedRef.current = enabled;
    if (enabled || !wasEnabled) return;
    actionTokenRef.current += 1;
    if (happyTimeoutRef.current !== null) {
      window.clearTimeout(happyTimeoutRef.current);
      happyTimeoutRef.current = null;
    }
    setPhase("idle");
  }, [enabled]);

  useEffect(() => {
    playHappy();
    return () => {
      if (happyTimeoutRef.current !== null) window.clearTimeout(happyTimeoutRef.current);
    };
  }, [playHappy]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!enabled) return;
    if (skipToggleHappyRef.current) {
      skipToggleHappyRef.current = false;
      return;
    }
    playHappy();
  }, [enabled, playHappy]);

  function handleActivate() {
    if (!enabled && !enableLatchedRef.current) {
      enableLatchedRef.current = true;
      skipToggleHappyRef.current = true;
      onEnable();
    }
    playHappy();
  }

  return (
    <button
      type="button"
      className={`dc-onb-cat-preview${enabled ? " is-on" : ""}`}
      onClick={handleActivate}
      aria-label={label}
      aria-pressed={enabled}
    >
      <span className="dc-onb-cat-stage__floor" aria-hidden="true" />
      <span className="dc-onb-cat-stage__mover" aria-hidden="true">
        <span className="dc-onb-cat-stage__scale">
          <PetModeCat
            phase={phase}
            facing="right"
            pawFrame={0}
            publishHitRegion={false}
            decorative
          />
        </span>
      </span>
    </button>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
