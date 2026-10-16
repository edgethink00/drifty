import { createContext, useContext } from "react";
import type { ActivityLabelsController } from "./useActivityBlockLabels";

export const ActivityLabelsContext = createContext<ActivityLabelsController | null>(null);

/** Null outside a live Day/Week dashboard; callers then keep the existing display. */
export function useActivityLabels(): ActivityLabelsController | null {
  return useContext(ActivityLabelsContext);
}

