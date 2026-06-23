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

const SORTED_CONTROL_FIELDS: readonly ControlField[] = [
  ...AI_CONTROL_FIELDS.filter((field) => field.control === "required"),
  ...AI_CONTROL_FIELDS.filter((field) => field.control === "optional"),
];

export function AiPrivacyReview() {
  return (
    <section className="ai-privacy-review" aria-label="AI privacy review">
      <div className="ai-privacy-review__boundary">
        <div className="ai-privacy-review__column ai-privacy-review__column--shared">
          <ul className="ai-privacy-review__list" aria-label="Fields shared with AI classification">
            {SORTED_CONTROL_FIELDS.map((field) => (
              <ControlRow field={field} key={field.label} />
            ))}
          </ul>
        </div>
        <div className="ai-privacy-review__column ai-privacy-review__column--local">
          <ul className="ai-privacy-review__locked-list" aria-label="Fields kept on device">
            {AI_EXCLUDED_FIELDS.map((field) => (
              <LockedRow field={field} key={field.label} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ControlRow({ field }: { readonly field: ControlField }) {
  if (field.control === "required") {
    return (
      <li className="ai-privacy-review__row ai-privacy-review__row--required">
        <RowText label={field.detail} helper={field.helper} />
      </li>
    );
  }

  return (
    <li className="ai-privacy-review__row ai-privacy-review__row--optional">
      <label className="ai-privacy-review__row-control">
        <RowText label={field.detail} helper={field.helper} />
        <ControlSwitch field={field} />
      </label>
    </li>
  );
}

function LockedRow({ field }: { readonly field: ExcludedField }) {
  return (
    <li className="ai-privacy-review__locked-row">
      <ExclusionGlyph />
      <RowText label={field.label} helper={field.detail} />
    </li>
  );
}

function RowText({ label, helper }: { readonly label: string; readonly helper: string }) {
  return (
    <span className="ai-privacy-review__row-text">
      <strong>{label}</strong>
      <small>{helper}</small>
    </span>
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

function ExclusionGlyph() {
  return <span className="ai-privacy-exclusion-glyph" aria-hidden="true" />;
}
