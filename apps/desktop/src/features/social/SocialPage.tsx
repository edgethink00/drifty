import type { LeaderboardPageProps } from "../leaderboard/LeaderboardPage";
import { LeaderboardPage } from "../leaderboard/LeaderboardPage";
import { SocialProfileView } from "./SocialProfileView";
import { useLocalization } from "../localization/LocalizationContext";
import "../leaderboard/leaderboard.css";
import "../leaderboard/rank-embeds.css";
import "./social.css";

export type SocialSection = "profile" | "leaderboard";

export type SocialPageProps = LeaderboardPageProps & {
  readonly activeSection: SocialSection;
};

export function SocialPage({ activeSection, ...leaderboardProps }: SocialPageProps) {
  const { t } = useLocalization();
  if (activeSection === "leaderboard") return <LeaderboardPage {...leaderboardProps} />;

  return (
    <div className="page social-page">
      <div className="pg-head social-page__head">
        <div>
          <h1>{t("social.profile.title")}</h1>
          <p className="page-subhead">{t("social.profile.subhead")}</p>
        </div>
      </div>

      <div className="social-page__body">
        <SocialProfileView
          isSignedIn={leaderboardProps.isSignedIn}
          isSupabaseEnabled={leaderboardProps.isSupabaseEnabled}
          profileDisplayName={leaderboardProps.profileDisplayName}
          publicProfile={leaderboardProps.publicProfile}
          onSignIn={leaderboardProps.onSignIn}
        />
      </div>
    </div>
  );
}
