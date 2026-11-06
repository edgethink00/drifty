import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeMemoryStatus } from "../screen-context/memoryWire";

const subscribeNone = () => () => {};
const snapshotNone = () => null;

/** Read only account-bound preferences; never fetch screen content for a menu. */
export function useMemoryTaskAvailable(client?: ScreenContextClient): boolean {
  const snapshot = useSyncExternalStore(client?.subscribe ?? subscribeNone, client?.getSnapshot ?? snapshotNone);
  const [available, setAvailable] = useState<{ client: ScreenContextClient; generation: number; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!client?.isDesktop()) return;
    let live = true;
    let pending = false;
    const read = () => {
      if (pending) return;
      pending = true;
      void client.consume("memory_get_status", {}, decodeMemoryStatus, (value, generation) => {
        if (live) setAvailable({ client, generation, enabled: value.supported && value.preferences.enabled });
      }).catch(() => { if (live) setAvailable(null); }).finally(() => { pending = false; });
    };
    read();
    const timer = setInterval(read, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [client, snapshot?.generation]);
  return Boolean(available?.enabled && available.client === client && client?.canDisplay(available.generation));
}
