import { useEffect, useState } from "react";

import { fetchTeamPresence } from "./teamSharingService";
import type { TeamMemberPresence } from "./teamTypes";

/** How often an open team page asks who is recording; members report every few minutes. */
export const TEAM_PRESENCE_POLL_MS = 60 * 1000;
const NONE: readonly TeamMemberPresence[] = [];

export type UseTeamPresenceInput = {
  /** A managed team inside its hours, seen by a seat that sees people. */
  readonly enabled: boolean;
  readonly organizationId: string | null;
};

/**
 * Who in a managed team is recording now, read while the team page is open.
 * A failed read keeps the last answer; another team, or leaving the hours,
 * starts empty.
 */
export function useTeamPresence({ enabled, organizationId }: UseTeamPresenceInput): readonly TeamMemberPresence[] {
  const key = enabled && organizationId ? organizationId : "";
  const [state, setState] = useState<{ readonly key: string; readonly rows: readonly TeamMemberPresence[] }>({ key: "", rows: NONE });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const read = async () => {
      const result = await fetchTeamPresence({ organization_id: key }).catch(() => null);
      if (cancelled || !result?.success) return;
      setState({ key, rows: result.data });
    };
    void read();
    const timer = setInterval(() => void read(), TEAM_PRESENCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);
  return state.key === key && key ? state.rows : NONE;
}
