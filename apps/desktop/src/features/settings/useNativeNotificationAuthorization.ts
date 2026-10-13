import { useCallback, useEffect, useState } from "react";

import {
  readNativeNotificationAuthorization,
  requestNativeNotificationAuthorization,
  type NativeNotificationAuthorization,
} from "../../lib/api/nativeNotificationClient";

/**
 * Drifty's macOS notification permission, re-read whenever Drifty comes back
 * to the front because the user may have changed it in System Settings.
 * `null` until the first read finishes.
 */
export function useNativeNotificationAuthorization() {
  const [authorization, setAuthorization] = useState<NativeNotificationAuthorization | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void readNativeNotificationAuthorization().then((value) => {
        if (!cancelled) setAuthorization(value);
      });
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
    };
  }, []);

  const request = useCallback(async () => {
    const value = await requestNativeNotificationAuthorization();
    setAuthorization(value);
    return value;
  }, []);

  return { authorization, request };
}

