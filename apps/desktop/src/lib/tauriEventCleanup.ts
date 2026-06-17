export type TauriEventUnlisten = () => void;

const SAFARI_STALE_LISTENER_CLEANUP_MESSAGE = "undefined is not an object (evaluating 'listeners[eventId].handlerId')";
const CHROMIUM_STALE_LISTENER_CLEANUP_MESSAGE = "Cannot read properties of undefined (reading 'handlerId')";

export function isStaleTauriListenerCleanupError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes(SAFARI_STALE_LISTENER_CLEANUP_MESSAGE)
    || error.message.includes(CHROMIUM_STALE_LISTENER_CLEANUP_MESSAGE)
  );
}

export function cleanupTauriEventListener(unlisten: TauriEventUnlisten | null | undefined): void {
  if (!unlisten) return;

  void Promise.resolve()
    .then(() => unlisten())
    .catch((error: unknown) => {
      if (isStaleTauriListenerCleanupError(error)) return;

      if (error instanceof Error) {
        console.warn("Unable to remove Tauri event listener.", error);
        return;
      }

      console.warn("Unable to remove Tauri event listener.", error);
    });
}
