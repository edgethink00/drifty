import "./AiSetupPanel.css";
import "./AiPrivacyReviewConcepts.css";

import { AiDataSendingRows, AiPrivacyDetails } from "./AiPrivacyReview";

export function AiPrivacyReviewConceptsApp() {
  return (
    <main className="privacy-review-concepts" aria-label="Privacy review concept">
      <div className="privacy-review-concepts__shell">
        <header className="privacy-review-concepts__header">
          <h1>Privacy review</h1>
        </header>
        <section className="privacy-review-concepts__stage content--settings" aria-label="Selected privacy review concept">
          <div className="settings-block">
            <h3>AI data sending</h3>
            <AiDataSendingRows onOpenDetails={() => undefined} />
          </div>
        </section>
        <section className="privacy-review-concepts__stage" aria-label="Details dialog content">
          <AiPrivacyDetails />
        </section>
      </div>
    </main>
  );
}
