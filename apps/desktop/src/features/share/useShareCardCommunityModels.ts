import { useEffect, useState } from "react";
import type { CommunityFocusPercentileModels } from "../companion/communityFocusPercentile";
import { loadCommunityFocusPercentileModels } from "../companion/communityFocusPercentileModelService";

/** Reuse the achievement model cache; no activity or membership is submitted. */
export function useShareCardCommunityModels() {
  const [models, setModels] = useState<CommunityFocusPercentileModels>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    void loadCommunityFocusPercentileModels().then((loaded) => {
      if (!disposed) setModels(loaded);
    }).catch(() => {
      // Focus-time cards remain available when comparison data cannot load.
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, []);
  return { models, loading };
}
