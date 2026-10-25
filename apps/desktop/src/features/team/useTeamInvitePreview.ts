import { useCallback, useEffect, useState } from "react";

import { previewTeamInvite } from "./teamInvitePreviewService";
import type { TeamInvitePreview, TeamResult } from "./teamTypes";

/** A response belongs only to the exact code currently in the field. */
export function useTeamInvitePreview(inviteKey: string, enabled: boolean) {
  const key = inviteKey.trim();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; result: TeamResult<TeamInvitePreview> } | null>(null);
  const refresh = useCallback(() => { setState(null); setAttempt((value) => value + 1); }, []);
  useEffect(() => {
    setState(null);
    if (!enabled || !key) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewTeamInvite(key).then((result) => { if (!cancelled) setState({ key, attempt, result }); })
        .catch(() => { if (!cancelled) setState({ key, attempt, result: { success: false, reason: "remote_error", error: "Unable to read team sharing settings." } }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [attempt, enabled, key]);
  const result = enabled && state?.key === key && state.attempt === attempt ? state.result : null;
  return {
    preview: result?.success ? result.data : null,
    loading: enabled && Boolean(key) && result === null,
    error: result && !result.success ? result.error : null,
    refresh,
  };
}
