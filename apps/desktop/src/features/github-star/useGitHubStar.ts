import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { capturePostHogDailyEvent, capturePostHogEvent } from "../../lib/analytics/posthogClient";
import {
  daysSinceFirstRun,
  hadProblemToday,
  isGitHubStarDone,
  loadGitHubStarAvailability,
  markGitHubStarDone,
  markGitHubStarProblemDay,
  openDriftyOnGitHub,
  readGitHubStarPreview,
  readOnboardingGitHubStarResult,
  settingsGitHubLinkShown,
  starCardDue,
  starDriftyOnGitHub,
  subscribeOnboardingGitHubStarResult,
  type GitHubStarAvailability,
  type GitHubStarPlacement,
  type GitHubStarUsage,
  type OnboardingGitHubStarResult,
} from "./githubStar";

export type GitHubStarModel = {
  /** Set only while the repository is public and the person has not starred it. */
  readonly availability: GitHubStarAvailability | null;
  readonly usage: GitHubStarUsage | null;
  /** The corner card may ask; the app still holds it while another dialog is open. */
  readonly cardDue: boolean;
  /** The GitHub row under Community in the Settings sidebar. */
  readonly settingsLinkShown: boolean;
  readonly star: () => Promise<boolean>;
  /** "Later" on the corner card: it does not ask again. */
  readonly dismiss: () => void;
  readonly openRepository: () => void;
  /** Call while the card or row is actually on screen. */
  readonly markShown: (placement: GitHubStarPlacement) => void;
};

export type GitHubStarInputs = {
  /** False in the browser preview and before the first data load. */
  readonly enabled: boolean;
  readonly loadUsage: () => Promise<GitHubStarUsage>;
  readonly organizationSeat: boolean;
  /** No recording, storage or AI problem showing right now. */
  readonly healthy: boolean;
};

/** Checks GitHub and the local history once per launch, after the app has settled. */
export function useGitHubStar({ enabled, loadUsage, organizationSeat, healthy }: GitHubStarInputs): GitHubStarModel {
  const preview = useMemo(() => readGitHubStarPreview(), []);
  const [availability, setAvailability] = useState<GitHubStarAvailability | null>(preview?.availability ?? null);
  const [usage, setUsage] = useState<GitHubStarUsage | null>(preview?.usage ?? null);
  const [done, setDone] = useState(() => (preview ? false : isGitHubStarDone()));
  const [problemToday, setProblemToday] = useState(() => (preview ? false : hadProblemToday(new Date())));
  const [firstRunDays] = useState(() => (preview ? preview.daysSinceFirstRun : daysSinceFirstRun(new Date())));
  const effectiveHealthy = preview ? preview.healthy : healthy;
  const effectiveSeat = preview ? preview.organizationSeat : organizationSeat;

  useEffect(() => {
    if (preview || effectiveHealthy) return;
    markGitHubStarProblemDay(new Date());
    setProblemToday(true);
  }, [effectiveHealthy, preview]);

  useEffect(() => {
    if (preview || !enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadGitHubStarAvailability().then(async (next) => {
        if (cancelled || !next) return;
        setAvailability(next);
        if (next.star === "starred") { markGitHubStarDone(); setDone(true); return; }
        if (!next.public || done) return;
        const loaded = await loadUsage().catch(() => null);
        if (!cancelled) setUsage(loaded);
      }).catch(() => undefined);
    }, 20_000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [done, enabled, loadUsage, preview]);

  const visible = availability?.public === true && availability.star !== "starred" ? availability : null;
  const cardDue = starCardDue({ availability, usage, daysSinceFirstRun: firstRunDays, done, organizationSeat: effectiveSeat, healthy: effectiveHealthy, problemToday });
  const settingsLinkShown = settingsGitHubLinkShown(availability, effectiveSeat);
  const method = availability?.star === "not_starred" ? "gh" : "browser";

  const shownOnce = useRef(new Set<GitHubStarPlacement>());
  const markShown = useCallback((placement: GitHubStarPlacement) => {
    if (preview || shownOnce.current.has(placement)) return;
    shownOnce.current.add(placement);
    capturePostHogDailyEvent("github_star_prompt", `github_star_prompt:shown:${placement}`, { action: "shown", placement, method: placement === "settings" ? "browser" : method });
  }, [method, preview]);

  const star = useCallback(async () => {
    if (!preview) capturePostHogEvent("github_star_prompt", { action: "clicked", placement: "corner", method });
    const starred = await starDriftyOnGitHub(method === "gh");
    if (!preview) setDone(true);
    return starred;
  }, [method, preview]);
  const dismiss = useCallback(() => {
    if (!preview) capturePostHogEvent("github_star_prompt", { action: "dismissed", placement: "corner", method });
    markGitHubStarDone();
    setDone(true);
  }, [method, preview]);
  const openRepository = useCallback(() => {
    if (!preview) capturePostHogEvent("github_star_prompt", { action: "clicked", placement: "settings", method: "browser" });
    void openDriftyOnGitHub().catch(() => undefined);
  }, [preview]);

  return { availability: visible, usage, cardDue, settingsLinkShown, star, dismiss, openRepository, markShown };
}


/** The outcome of the onboarding star, until the main window has reported it. */
export function useOnboardingGitHubStarResult(): OnboardingGitHubStarResult | null {
  return useSyncExternalStore(subscribeOnboardingGitHubStarResult, readOnboardingGitHubStarResult);
}
