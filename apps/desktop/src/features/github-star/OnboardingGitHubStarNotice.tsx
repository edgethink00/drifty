import { useEffect } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { StarIcon } from "./GitHubStarCard";
import type { OnboardingGitHubStarResult } from "./githubStar";
import "./GitHubStarCard.css";

/** Long enough to read the failure line, which names where to star instead. */
const VISIBLE_MS = 8_000;

/** Reports the onboarding star once the main window shows, in the corner card's place. */
export function OnboardingGitHubStarNotice({ result, onClose }: {
  readonly result: OnboardingGitHubStarResult;
  readonly onClose: () => void;
}) {
  const { t } = useLocalization();
  useEffect(() => {
    const timer = window.setTimeout(onClose, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="github-star github-star--notice" data-placement="corner" data-outcome={result.starred ? "starred" : "failed"} role="status">
      <StarIcon />
      <span>
        {result.starred
          ? t("onboarding.ready.githubStarDone", { account: "@" + result.account })
          : t("onboarding.ready.githubStarFailed")}
      </span>
    </div>
  );
}
