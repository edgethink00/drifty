const AI_VISIBLE_FIELDS = [
  "App name and basic app context",
  "Browser or site domain",
  "Page title or window title",
  "Activity duration",
  "Your saved work profile",
] as const;

const AI_EXCLUDED_FIELDS = [
  "Raw timeline rows",
  "Full session history",
  "Provider API keys",
] as const;

export function AiPrivacyReview() {
  return (
    <section className="ai-privacy-review" aria-label="AI privacy review">
      <div className="ai-privacy-review__header">
        <div>
          <span className="eyebrow">Privacy review</span>
          <h3>What AI classification can see</h3>
        </div>
        <span className="chip green">No raw cloud timeline</span>
      </div>
      <div className="ai-privacy-review__checklist" role="list" aria-label="Fields sent to AI classification providers">
        {AI_VISIBLE_FIELDS.map((field) => (
          <label className="ai-privacy-check" key={field}>
            <input type="checkbox" checked readOnly tabIndex={-1} aria-label={`${field} is sent to AI classification providers`} />
            <span>{field}</span>
          </label>
        ))}
      </div>
      <div className="ai-privacy-review__excluded" aria-label="Fields not sent to AI providers">
        <span>Not sent</span>
        <div>
          {AI_EXCLUDED_FIELDS.map((field) => (
            <span key={field}>{field}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
