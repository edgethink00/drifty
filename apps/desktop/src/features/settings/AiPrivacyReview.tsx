type VisibleField = {
  readonly label: string;
  readonly detail: string;
  readonly scope: "app" | "site" | "title" | "time" | "profile";
};

type ExcludedField = {
  readonly label: string;
  readonly detail: string;
};

type ControlField = VisibleField & {
  readonly control: "required" | "optional";
  readonly enabled: boolean;
  readonly helper: string;
};

const AI_VISIBLE_FIELDS: readonly VisibleField[] = [
  { label: "App context", detail: "App name and basic app context", scope: "app" },
  { label: "Site domain", detail: "Browser or site domain", scope: "site" },
  { label: "Window title", detail: "Page title or window title", scope: "title" },
  { label: "Duration", detail: "Activity duration", scope: "time" },
  { label: "Work profile", detail: "Your saved work profile", scope: "profile" },
] as const;

const AI_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  { label: "Raw timeline rows", detail: "No full activity row upload" },
  { label: "Full session history", detail: "No replayable day history" },
  { label: "Provider API keys", detail: "Stored locally, never sent as samples" },
] as const;

const AI_CONTROL_FIELDS: readonly ControlField[] = AI_VISIBLE_FIELDS.map((field) => {
  if (field.scope === "app" || field.scope === "time") {
    return {
      ...field,
      control: "required",
      enabled: true,
      helper: "Needed for a useful category result.",
    };
  }

  return {
    ...field,
    control: "optional",
    enabled: true,
    helper: field.scope === "profile" ? "Useful for personalized work categories." : "Helps distinguish work from drift.",
  };
});

export function AiPrivacyReview() {
  const requiredFields = AI_CONTROL_FIELDS.filter((field) => field.control === "required");
  const optionalFields = AI_CONTROL_FIELDS.filter((field) => field.control === "optional");

  return (
    <section className="ai-privacy-review" aria-label="AI privacy review">
      <div className="ai-privacy-review__boundary">
        <div className="ai-privacy-review__column">
          <ColumnLabel label="Required for classification" meta="Locked on" />
          <div className="ai-privacy-review__list" role="list" aria-label="Required AI classification fields">
            {requiredFields.map((field) => (
              <ControlRow field={field} key={field.label} />
            ))}
          </div>
          <ColumnLabel label="Optional context" meta="User controlled" />
          <div className="ai-privacy-review__list" role="list" aria-label="Optional AI classification fields">
            {optionalFields.map((field) => (
              <ControlRow field={field} key={field.label} />
            ))}
          </div>
        </div>
        <LockedLocalColumn />
      </div>
    </section>
  );
}

function ColumnLabel({ label, meta }: { readonly label: string; readonly meta: string }) {
  return (
    <div className="ai-privacy-review__label">
      <span>{label}</span>
      <strong>{meta}</strong>
    </div>
  );
}

function ControlRow({ field }: { readonly field: ControlField }) {
  if (field.control === "required") {
    return (
      <div className="ai-privacy-review__row ai-privacy-review__row--required" role="listitem">
        <span>
          <strong>{field.detail}</strong>
          <small>{field.helper}</small>
        </span>
        <em>Required</em>
      </div>
    );
  }

  return (
    <label className="ai-privacy-review__row ai-privacy-review__row--optional" role="listitem">
      <span>
        <strong>{field.detail}</strong>
        <small>{field.helper}</small>
      </span>
      <ControlSwitch field={field} />
    </label>
  );
}

function ControlSwitch({ field }: { readonly field: ControlField }) {
  return (
    <span className="ai-privacy-review__switch">
      <input defaultChecked={field.enabled} role="switch" type="checkbox" aria-label={field.detail} />
      <span aria-hidden="true" />
    </span>
  );
}

function LockedLocalColumn() {
  return (
    <div className="ai-privacy-review__column ai-privacy-review__column--local">
      <ColumnLabel label="Always local" meta="Locked local" />
      <LockedFieldList />
    </div>
  );
}

function LockedFieldList() {
  return (
    <div className="ai-privacy-review__locked-list" role="list" aria-label="Fields kept local">
      {AI_EXCLUDED_FIELDS.map((field) => (
        <div className="ai-privacy-review__locked-row" key={field.label} role="listitem">
          <ExclusionGlyph />
          <span>
            <strong>{field.label}</strong>
            <small>{field.detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ExclusionGlyph() {
  return <span className="ai-privacy-exclusion-glyph" aria-hidden="true" />;
}
