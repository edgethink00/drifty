/**
 * Hands the tracker the latest developer-diagnostics settings without sending
 * the same value over and over.
 *
 * The caller may request on every render: an unchanged value the tracker
 * confirmed within the last `reconfirmAfterMs` costs nothing. After that it
 * is sent once more, so a tracker database that was replaced mid-session (for
 * example restored from a backup after corruption) picks the settings back up.
 * At most one send is in flight, so two quick changes reach the tracker in
 * order. A failed send is not retried on its own; the next request tries again.
 */
export function createDeveloperDiagnosticsSync<T>(
  send: (settings: T) => Promise<unknown>,
  onError: (error: unknown) => void,
  options: { readonly reconfirmAfterMs?: number; readonly now?: () => number } = {},
): { request(settings: T): void } {
  const reconfirmAfterMs = options.reconfirmAfterMs ?? 60_000;
  const now = options.now ?? Date.now;
  let confirmedKey: string | null = null;
  let confirmedAtMs = 0;
  let inFlightKey: string | null = null;
  let pending: { readonly key: string; readonly settings: T } | null = null;

  function isConfirmed(key: string) {
    return key === confirmedKey && now() - confirmedAtMs < reconfirmAfterMs;
  }

  function sendPending() {
    if (inFlightKey !== null || pending === null) return;
    const next = pending;
    pending = null;
    if (isConfirmed(next.key)) return;
    inFlightKey = next.key;
    void Promise.resolve()
      .then(() => send(next.settings))
      .then(
        () => {
          confirmedKey = next.key;
          confirmedAtMs = now();
        },
        (error: unknown) => {
          // Leave the failed value for the next request rather than looping.
          if (pending?.key === next.key) pending = null;
          onError(error);
        },
      )
      .finally(() => {
        inFlightKey = null;
        sendPending();
      });
  }

  return {
    request(settings: T) {
      const key = JSON.stringify(settings);
      if (inFlightKey === null && isConfirmed(key)) return;
      pending = { key, settings };
      sendPending();
    },
  };
}
