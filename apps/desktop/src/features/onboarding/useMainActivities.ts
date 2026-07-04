import { useState } from "react";
import { MAX_MAIN_ACTIVITY_SELECTIONS } from "./constants";

type UseMainActivitiesInitialState = {
  readonly mainActivities?: readonly string[] | undefined;
  readonly mainActivityOther?: string | undefined;
};

export function useMainActivities(initialState: UseMainActivitiesInitialState = {}) {
  const [mainActivities, setMainActivities] = useState<string[]>(() =>
    Array.from(new Set(initialState.mainActivities ?? []))
      .map((activity) => activity.trim())
      .filter(Boolean)
      .slice(0, MAX_MAIN_ACTIVITY_SELECTIONS),
  );
  const [mainActivityOther, setMainActivityOther] = useState(initialState.mainActivityOther ?? "");

  function toggleMainActivity(option: string) {
    setMainActivities((current) => {
      if (current.includes(option)) return current.filter((item) => item !== option);
      if (current.length >= MAX_MAIN_ACTIVITY_SELECTIONS) return current;
      return [...current, option];
    });
  }

  function addMainActivity(option: string) {
    if (!option) return;
    setMainActivities((current) => {
      if (current.includes(option) || current.length >= MAX_MAIN_ACTIVITY_SELECTIONS) return current;
      return [...current, option];
    });
  }

  return {
    addMainActivity,
    mainActivities,
    mainActivityOther,
    setMainActivityOther,
    toggleMainActivity,
  };
}
