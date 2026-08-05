import type { LeaderboardPageProps } from "../leaderboard/LeaderboardPage";
import { LeaderboardPage } from "../leaderboard/LeaderboardPage";
import { SocialProfileView } from "./SocialProfileView";
import "../leaderboard/leaderboard.css";
import "../leaderboard/rank-embeds.css";
import "./social.css";

export type SocialSection = "profile" | "leaderboard";

export type SocialPageProps = LeaderboardPageProps & {
  readonly activeSection: SocialSection;
};

export function SocialPage({ activeSection, ...leaderboardProps }: SocialPageProps) {
  if (activeSection === "leaderboard") return <LeaderboardPage {...leaderboardProps} />;

  return (
    <div className="page social-page">
      <div className="pg-head social-page__head">
        <div>
          <span className="eyebrow">Public, by choice</span>
          <h1>Profile</h1>
          <p className="page-subhead">Choose what appears publicly and create portable embeds.</p>
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
