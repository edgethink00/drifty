import { useEffect, useRef, useState } from "react";

// Ambient, app-wide signal for "is AI classification running right now, and roughly how many
// segments are left". Wrapped around the service-level run entry points so every caller — the
// first-day gate, the post-reveal fill-in, the periodic auto-batch, and manual runs — feeds
// the same store without touching individual call sites. The top status pill subscribes to it.

export interface ClassificationActivityState {
  readonly running: boolean;
  /** Best-effort count of segments still unclassified for the active run's scope; null if unknown. */
  readonly remaining: number | null;
}

type Listener = (state: ClassificationActivityState) => void;

const IDLE_STATE: ClassificationActivityState = { running: false, remaining: null };

let state: ClassificationActivityState = IDLE_STATE;
// Runs can nest (e.g. runAiClassificationUntilEmpty wraps runAiClassification per batch);
// a counter keeps `running` true across the whole outer run instead of flickering per batch.
let activeRuns = 0;
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = state;
  for (const listener of listeners) listener(snapshot);
}

export function getClassificationActivitySnapshot(): ClassificationActivityState {
  return state;
}

export function subscribeClassificationActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginClassificationRun(): void {
  activeRuns += 1;
  if (!state.running) {
    state = { running: true, remaining: state.remaining };
    emit();
  }
}

export function endClassificationRun(): void {
  activeRuns = Math.max(0, activeRuns - 1);
  if (activeRuns === 0) {
    state = IDLE_STATE;
    emit();
  }
}

export function reportClassificationRemaining(remaining: number | null): void {
  const normalized = typeof remaining === "number" && Number.isFinite(remaining) ? Math.max(0, Math.round(remaining)) : null;
  if (!state.running || normalized === state.remaining) return;
  state = { running: true, remaining: normalized };
  emit();
}

// Wrap an async classification run so the activity signal brackets it and picks up the
// remaining count from its summary when cheaply available.
export async function withClassificationActivity<T>(run: () => Promise<T>, remainingFrom: (result: T) => number | null): Promise<T> {
  beginClassificationRun();
  try {
    const result = await run();
    reportClassificationRemaining(remainingFrom(result));
    return result;
  } finally {
    endClassificationRun();
  }
}

// React binding for the pill. Debounced so a sub-second run never flashes the pill: `running`
// only flips true after it has stayed true for `debounceMs`; it clears immediately on idle.
export function useClassificationActivity(debounceMs = 350): ClassificationActivityState {
  const [raw, setRaw] = useState<ClassificationActivityState>(getClassificationActivitySnapshot);

  useEffect(() => {
    setRaw(getClassificationActivitySnapshot());
    return subscribeClassificationActivity(setRaw);
  }, []);

  const [debouncedRunning, setDebouncedRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!raw.running) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDebouncedRunning(false);
      return undefined;
    }
    if (debouncedRunning) return undefined;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDebouncedRunning(true);
    }, debounceMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [raw.running, debouncedRunning, debounceMs]);

  return debouncedRunning ? { running: true, remaining: raw.remaining } : IDLE_STATE;
}
