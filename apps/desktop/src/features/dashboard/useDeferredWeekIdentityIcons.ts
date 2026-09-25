import { useEffect, useState } from "react";

type DeferredWeekIdentityIconsInput = {
  readonly endDay: string;
  readonly startDay: string;
};

// Paint a newly shown week's calendar first, then attach its app and site icons
// on the next frame so a heavy week's icons never hold back the calendar. The
// readiness is keyed on the visible range only: refreshed data inside the same
// week keeps mounted icons in place instead of dropping and re-adding them.
export function useDeferredWeekIdentityIcons({ endDay, startDay }: DeferredWeekIdentityIconsInput): boolean {
  const rangeKey = `${startDay}:${endDay}`;
  const [readyRangeKey, setReadyRangeKey] = useState<string | null>(null);

  useEffect(() => {
    if (readyRangeKey === rangeKey) return undefined;
    if (typeof window.requestAnimationFrame !== "function") {
      setReadyRangeKey(rangeKey);
      return undefined;
    }

    const frameHandle = window.requestAnimationFrame(() => setReadyRangeKey(rangeKey));
    return () => window.cancelAnimationFrame(frameHandle);
  }, [rangeKey, readyRangeKey]);

  return readyRangeKey === rangeKey;
}

