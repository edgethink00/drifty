import { useEffect, useState } from "react";
import type { CommunityFocusPercentileModels } from "../companion/communityFocusPercentile";
import { loadCommunityFocusPercentileModels, peekCommunityFocusPercentileModels } from "../companion/communityFocusPercentileModelService";
import { shareCardRequestDeadline } from "./shareCardRequestDeadline";

/** Use a prepared model on the first render and keep this sheet's snapshot stable. */
export function useShareCardCommunityModels() {
  const [state, setState] = useState(() => {
    const models = peekCommunityFocusPercentileModels();
    return { models, loading: models === undefined };
  });
  useEffect(() => {
    if (!state.loading) return;
    let disposed = false;
    void shareCardRequestDeadline<CommunityFocusPercentileModels | undefined>(loadCommunityFocusPercentileModels(), undefined).then(models => {
      if (!disposed) setState({ models, loading: false });
    });
    return () => { disposed = true; };
  }, [state.loading]);
  return state;
}
