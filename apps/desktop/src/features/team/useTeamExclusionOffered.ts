import { useEffect, useState } from "react";

import { fetchTeamBlockExclusion } from "./teamGroupsService";
import { fetchOwnTeams } from "./teamService";
import { fetchTeamServerPolicy } from "./teamSharingService";

const REFRESH_MS = 30 * 60 * 1000;

/** Only confirmed teams that automatically share and permit exclusions offer the choice. */
async function readAvailability(): Promise<boolean> {
  const teams = await fetchOwnTeams();
  if (!teams.success) return false;
  const available = await Promise.all(teams.data.map(async (team) => {
    try {
      const input = { organization_id: team.organization_id };
      const policy = await fetchTeamServerPolicy(input);
      if (!policy.success || !policy.data?.policy) return false;
      const exclusion = await fetchTeamBlockExclusion(input);
      return exclusion.success && exclusion.data === true;
    } catch {
      return false;
    }
  }));
  return available.some(Boolean);
}

/** Read on opening and after team changes, independent of classification or automatic sharing. */
export function useTeamExclusionOffered(enabled: boolean, accountKey: string | null, teamsKey: string): boolean {
  const [result, setResult] = useState<{ accountKey: string; teamsKey: string; offered: boolean } | null>(null);
  useEffect(() => {
    let current = true;
    let request = 0;
    setResult(null);
    if (!enabled || !accountKey) return () => { current = false; };
    const read = () => {
      const sequence = ++request;
      void readAvailability().catch(() => false).then((offered) => {
        if (current && sequence === request) setResult({ accountKey, teamsKey, offered });
      });
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    const policyChanged = () => { setResult(null); read(); };
    window.addEventListener("drifty:team-exclusion-policy-changed", policyChanged);
    return () => { current = false; clearInterval(timer); window.removeEventListener("drifty:team-exclusion-policy-changed", policyChanged); };
  }, [enabled, accountKey, teamsKey]);
  return Boolean(enabled && accountKey && result?.accountKey === accountKey && result.teamsKey === teamsKey && result.offered);
}
