import { useState } from "react";
import { memorySuggestionExamplesAllowed, type StoredSuggestion } from "../classification/memorySuggestionStore";
import { localizedProductivityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { MemoryIcon } from "./memoryIcons";
import { reportSuggestionAction } from "./useMemorySuggestions";

type Props = {
  readonly suggestions: readonly StoredSuggestion[];
  readonly busy: boolean;
  readonly onAccept: (id: string) => void;
  readonly onDecline: (id: string) => void;
};

/** Suggested memories: not used by the classifier until the user adds them. */
export function MemorySuggestionList({ suggestions, busy, onAccept, onDecline }: Props) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const kindLabels = {
    work: t("settings.ai.memoryPatternKindWork"),
    drift: t("settings.ai.memoryPatternKindDrift"),
    ambiguous: t("settings.ai.memoryPatternKindAmbiguity"),
  };
  return <div className="memory-card">
    <div className="memory-list">
      {suggestions.map((suggestion) => {
        const place = suggestion.domain ? suggestion.app + " / " + suggestion.domain : suggestion.app;
        const open = Boolean(expanded[suggestion.id]);
        const detailId = "memory-suggestion-" + suggestion.id.replace(/[^a-z0-9]/gi, "").slice(0, 32);
        const examples = memorySuggestionExamplesAllowed() ? suggestion.examples ?? [] : [];
        return <article className="memory-row" key={suggestion.id} aria-label={suggestion.summary}>
          <p className="memory-row__summary">{suggestion.summary}</p>
          <div className="memory-row__meta">
            <span className={"memory-row__kind memory-row__kind--" + (suggestion.kind === "work" ? "workSupport" : suggestion.kind === "drift" ? "drift" : "ambiguities")}>{kindLabels[suggestion.kind]}</span>
            <span>{place}</span>
            <span>{t("settings.ai.memorySuggestionStats", { minutes: suggestion.minutes, days: suggestion.days })}</span>
            <button className="memory-row__toggle" type="button" aria-expanded={open} aria-controls={detailId}
              onClick={() => {
                if (!open) reportSuggestionAction("details_opened", suggestion, "success");
                setExpanded((current) => ({ ...current, [suggestion.id]: !current[suggestion.id] }));
              }}>
              {t("settings.ai.memoryDetails")}<MemoryIcon name="chevronDown" size={13} />
            </button>
          </div>
          <div className="memory-row__actions">
            <div className="memory-feedback" role="group" aria-label={t("settings.ai.memorySuggestionFeedbackAria")}>
              <button className="memory-feedback__btn memory-feedback__btn--up" type="button" disabled={busy}
                aria-label={t("settings.ai.memorySuggestionAdd")} title={t("settings.ai.memorySuggestionAddHint")}
                onClick={() => onAccept(suggestion.id)}>
                <MemoryIcon name="thumbsUp" />
              </button>
              <button className="memory-feedback__btn memory-feedback__btn--down" type="button" disabled={busy}
                aria-label={t("settings.ai.memoryReject")} title={t("settings.ai.memorySuggestionRejectHint")}
                onClick={() => onDecline(suggestion.id)}>
                <MemoryIcon name="thumbsDown" />
              </button>
            </div>
          </div>
          {open ? <div className="memory-detail" id={detailId}>
            <p className="memory-detail__title">{t("settings.ai.memorySuggestionBasis")}</p>
            {examples.length > 0 ? <>
              <p className="memory-detail__lead">{t("settings.ai.memorySuggestionBasisLead")}</p>
              <ul className="memory-examples">
                {examples.map((example, index) => <li key={index}>
                  <span className={"memory-examples__label memory-examples__label--" + example.filedAs}>
                    {example.filedAs === "unclassified" ? t("settings.ai.memorySuggestionUnclassified") : localizedProductivityLabel(example.filedAs, t)}
                  </span>
                  <span className="memory-examples__title">{example.title}</span>
                  <span className="memory-examples__time">{t("settings.ai.memorySuggestionExampleMinutes", { minutes: example.minutes })}</span>
                </li>)}
              </ul>
            </> : <p className="memory-detail__note">{t("settings.ai.memorySuggestionNoExamples")}</p>}
            {/* How a suggestion was made answers "what is this based on", so it sits
                here instead of under every list. */}
            <p className="memory-detail__note">{t("settings.ai.memorySuggestionDisclosure")}</p>
          </div> : null}
        </article>;
      })}
    </div>
  </div>;
}
