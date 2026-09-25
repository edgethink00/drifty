import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long an inline "Copied" confirmation stays before the control returns to
 * its idle label. Every copy control shares this value so the confirmation
 * reads the same everywhere in the app.
 */
export const COPY_FEEDBACK_VISIBLE_MS = 2_000;

export type CopyFeedback<Key> = {
  /** The control currently showing its confirmation, or null. */
  readonly copiedKey: Key | null;
  /** Show the confirmation on `key` for the full window, replacing any earlier one. */
  readonly showCopied: (key: Key) => void;
  /** Drop the confirmation immediately, for example after a failed copy. */
  readonly clearCopied: () => void;
};

/**
 * Owns one reset timer per component. Each confirmation restarts the window, so
 * a second copy never inherits the first copy's countdown and disappears early.
 */
export function useCopyFeedback<Key>(visibleMs: number = COPY_FEEDBACK_VISIBLE_MS): CopyFeedback<Key> {
  const [copiedKey, setCopiedKey] = useState<Key | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const cancelResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) return;
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  useEffect(() => cancelResetTimer, [cancelResetTimer]);

  const showCopied = useCallback((key: Key) => {
    cancelResetTimer();
    setCopiedKey(key);
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      setCopiedKey(null);
    }, visibleMs);
  }, [cancelResetTimer, visibleMs]);

  const clearCopied = useCallback(() => {
    cancelResetTimer();
    setCopiedKey(null);
  }, [cancelResetTimer]);

  return { copiedKey, showCopied, clearCopied };
}
