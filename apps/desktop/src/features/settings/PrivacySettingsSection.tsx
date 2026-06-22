import { AiPrivacyReview } from "./AiPrivacyReview";

export function PrivacySettingsSection() {
  return (
    <div className="settings-section settings-section--privacy">
      <div className="settings-block">
        <h3>Privacy review</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Raw tracking history is not published</div>
            <div className="desc">Leaderboard and profile features publish aggregates only. AI classification may send minimized activity fields to configured providers for the request, but Drifty does not store raw tracking history for leaderboard or profile publishing.</div>
          </div>
          <div className="ctrl"><span className="chip green">Privacy first</span></div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Optional cloud features are explicit</div>
            <div className="desc">If you configure Supabase and join the leaderboard, Drifty publishes your public profile card plus a rolling 7 day focus total. Raw tracking history is not published there.</div>
          </div>
          <div className="ctrl"><span className="chip">Opt-in only</span></div>
        </div>
      </div>
      <AiPrivacyReview />
    </div>
  );
}
