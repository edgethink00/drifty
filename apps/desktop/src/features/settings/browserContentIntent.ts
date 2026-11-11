export type BrowserContentIntentStatus = "unmanaged" | "pending" | "applied" | "failed";

type Snapshot = {
  readonly enabled: boolean;
  readonly generation: string | null;
  readonly status: BrowserContentIntentStatus;
};

export function createBrowserContentIntent(
  initialEnabled: boolean,
  prepare?: (enabled: boolean) => Promise<string | null>,
) {
  let snapshot: Snapshot = { enabled: initialEnabled, generation: null, status: prepare ? "pending" : "unmanaged" };
  const listeners = new Set<() => void>();
  let currentRequest = 0;
  let started = false;
  // Serialize short native intent writes, never the SQLite calls.
  let intentQueue = Promise.resolve();

  function publish(next: Snapshot) {
    snapshot = next;
    for (const notify of listeners) notify();
  }

  function request(enabled: boolean, retry = false) {
    if (!retry && started && enabled === snapshot.enabled) return;
    started = true;
    const requestId = ++currentRequest;
    if (!prepare) {
      if (snapshot.enabled !== enabled) publish({ enabled, generation: null, status: "unmanaged" });
      return;
    }
    publish({ enabled, generation: null, status: "pending" });
    const intent = intentQueue.then(() => prepare(enabled));
    intentQueue = intent.then(() => undefined, () => undefined);
    void intent.then(
      (generation) => {
        if (requestId !== currentRequest) return;
        publish({ enabled, generation, status: generation ? (enabled ? "pending" : "applied") : "failed" });
      },
      () => {
        if (requestId === currentRequest) publish({ enabled, generation: null, status: "failed" });
      },
    );
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    request,
    retry: () => request(snapshot.enabled, true),
    finishOn(generation: string, applied: boolean) {
      if (snapshot.generation !== generation || !snapshot.enabled) return;
      const status = applied ? "applied" : "failed";
      if (status !== snapshot.status) publish({ ...snapshot, status });
    },
  };
}
