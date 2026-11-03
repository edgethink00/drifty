import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PetModeCat } from "../../pet-mode/PetModeCat";
import "../../pet-mode/petMode.css";

const HAPPY_MS = 1_200;
/** The first-run cat's ivory coat, shared by the cat tile and the Automatic close preview. */
export const IVORY_CAT_STYLE = {
  "--pet-fur": "#e8e5da", "--pet-ink": "#171916", "--pet-accent": "#a9d66d",
  "--pet-raster-filter": "url(#pet-mode-coat-ivory)", "--pet-drag-raster-filter": "url(#pet-mode-coat-ivory)",
  "--pet-contact-shadow": "rgba(0, 0, 0, .28)", "--pet-drop-shadow": "drop-shadow(0 3px 3px rgba(0, 0, 0, 0.22))",
} as CSSProperties;
const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The desktop cat beside its own switch, on the dark tile the first-run setup used: touching it turns the
 * cat on, and turning it on (by touch or switch) makes it greet.
 */
export function GuideCatTile({ enabled, label, onEnable, greetSignal = 0 }: {
  readonly enabled: boolean;
  readonly label: string;
  readonly onEnable: () => void;
  /** Changing this makes an awake cat greet again (the cat hears the name it was just given). */
  readonly greetSignal?: number;
}) {
  const [happy, setHappy] = useState(false);
  const timer = useRef<number | null>(null);
  const was = useRef(enabled);
  const greet = () => {
    if (reducedMotion()) return;
    setHappy(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHappy(false), HAPPY_MS);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (enabled && !was.current) greet();
    was.current = enabled;
  }, [enabled]);
  const lastGreetSignal = useRef(greetSignal);
  useEffect(() => {
    if (greetSignal === lastGreetSignal.current) return;
    lastGreetSignal.current = greetSignal;
    if (enabled) greet();
  }, [enabled, greetSignal]);
  return <button type="button" className="guide-cat-tile" data-on={enabled || undefined} aria-label={label} aria-pressed={enabled}
    onClick={() => { if (!enabled) onEnable(); else greet(); }}>
    <span className="guide-cat-tile__floor" aria-hidden="true" />
    <span className="guide-cat-tile__cat" aria-hidden="true" style={IVORY_CAT_STYLE}>
      <PetModeCat phase={happy ? "happy" : enabled ? "idle" : "sleep"} facing="right" pawFrame={0} publishHitRegion={false} decorative />
    </span>
  </button>;
}
