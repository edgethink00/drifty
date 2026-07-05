export function scheduleIdleWork(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function" && typeof window.cancelIdleCallback === "function") {
    const cancelIdleCallback = window.cancelIdleCallback;
    const handle = window.requestIdleCallback(callback, { timeout: 1200 });
    return () => cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(callback, 1);
  return () => window.clearTimeout(handle);
}
