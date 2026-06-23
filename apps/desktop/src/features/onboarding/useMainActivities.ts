import { useState } from "react";
import { MAX_MAIN_ACTIVITY_SELECTIONS } from "./constants";

export function useMainActivities() {
  const [mainActivities, setMainActivities] = useState<string[]>([]);
  const [mainActivityOther, setMainActivityOther] = useState("");

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
