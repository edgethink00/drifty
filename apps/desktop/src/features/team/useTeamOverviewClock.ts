import { useEffect, useMemo, useState } from "react";

import { resolveTeamPreviewClock } from "./teamPreview";

/** Keep live hours and presence current while leaving review scenarios fixed. */
export function useTeamOverviewClock(startOfDayMinutes: number, preview: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (preview) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [preview]);
  return useMemo(() => resolveTeamPreviewClock(startOfDayMinutes, now, preview), [now, preview, startOfDayMinutes]);
}
