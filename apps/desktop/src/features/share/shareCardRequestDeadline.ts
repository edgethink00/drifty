/** Bound share-sheet preparation without cancelling another feature's shared model request. */
export function shareCardRequestDeadline<T>(request: Promise<T>, fallback: T, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => resolve(fallback), timeoutMs);
    void request.then((value) => { globalThis.clearTimeout(timer); resolve(value); }, () => {
      globalThis.clearTimeout(timer);
      resolve(fallback);
    });
  });
}
