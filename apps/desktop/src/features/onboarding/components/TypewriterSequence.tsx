import { useEffect, useRef, useState } from "react";

export type TypewriterSegment = {
  text: string;
  className?: string;
};

type Props = {
  segments: ReadonlyArray<TypewriterSegment>;
  speed?: number;
  onComplete?: () => void;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TypewriterSequence({ segments, speed = 40, onComplete }: Props) {
  const reduced = prefersReducedMotion();
  const [segIdx, setSegIdx] = useState(reduced ? segments.length : 0);
  const [charIdx, setCharIdx] = useState(0);
  const [done, setDone] = useState(reduced);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (reduced) {
      if (!done) {
        setDone(true);
        onCompleteRef.current?.();
      }
      return;
    }
    if (done) return;
    if (segIdx >= segments.length) {
      setDone(true);
      onCompleteRef.current?.();
      return;
    }
    const seg = segments[segIdx];
    if (charIdx >= seg.text.length) {
      const pauseId = window.setTimeout(() => {
        setSegIdx((s) => s + 1);
        setCharIdx(0);
      }, 200);
      return () => window.clearTimeout(pauseId);
    }
    const tickId = window.setTimeout(() => setCharIdx((c) => c + 1), speed);
    return () => window.clearTimeout(tickId);
  }, [charIdx, done, reduced, segIdx, segments, speed]);

  return (
    <div className="onb-typewriter">
      {segments.map((seg, i) => {
        if (!reduced && i > segIdx) return null;
        const text = reduced || i < segIdx ? seg.text : seg.text.slice(0, charIdx);
        const showCursor = !done && i === segIdx;
        return (
          <span key={i} className={seg.className ?? ""}>
            {text}
            {showCursor ? <span className="onb-typewriter__cursor" /> : null}
          </span>
        );
      })}
    </div>
  );
}
