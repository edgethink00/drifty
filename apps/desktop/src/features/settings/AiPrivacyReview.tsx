import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
  saveAiPrivacyRequestSettings,
  updateAiPrivacyRequestOptionalSetting,
  type AiPrivacyRequestOptionalSettings,
  type AiPrivacyRequestSettings,
} from "./aiPrivacyRequestSettings";
import { resolveInitialEnhancedContextSettings } from "./settingsStorage";
import "./AiPrivacyReview.css";

type VisibleField = {
  readonly detailKey: TranslationKey;
  readonly scope: "app" | "site" | "windowTitle" | "content" | "time" | "profile";
  readonly required?: boolean;
  readonly settingKey?: keyof AiPrivacyRequestOptionalSettings;
};

type ExcludedField = {
  readonly labelKey: TranslationKey;
  readonly detailKey: TranslationKey;
  /** Receipt-grade wording, used by the never-sent list. */
  readonly receiptDetailKey: TranslationKey;
};

export type ControlField = VisibleField & {
  readonly control: "required" | "optional";
  readonly enabled: boolean;
};

const AI_VISIBLE_FIELDS: readonly VisibleField[] = [
  { detailKey: "settings.aiPrivacy.appContext", scope: "app", required: true },
  { detailKey: "settings.aiPrivacy.duration", scope: "time", required: true },
  { detailKey: "settings.aiPrivacy.siteDomain", scope: "site", required: true },
  { detailKey: "settings.aiPrivacy.siteUrl", scope: "site", settingKey: "siteUrl" },
  { detailKey: "settings.aiPrivacy.windowTitle", scope: "windowTitle", settingKey: "windowTitle" },
  {
    detailKey: "settings.aiPrivacy.contentContext",
    scope: "content",
    settingKey: "contentContext",
  },
  { detailKey: "settings.aiPrivacy.workProfile", scope: "profile", settingKey: "workProfile" },
] as const;

export const AI_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  {
    labelKey: "settings.aiPrivacy.rawTimeline",
    detailKey: "settings.aiPrivacy.rawTimelineDetail",
    receiptDetailKey: "settings.aiPrivacy.rawTimelineReceipt",
  },
  {
    labelKey: "settings.aiPrivacy.fullHistory",
    detailKey: "settings.aiPrivacy.fullHistoryDetail",
    receiptDetailKey: "settings.aiPrivacy.fullHistoryReceipt",
  },
  {
    labelKey: "settings.aiPrivacy.rawBodies",
    detailKey: "settings.aiPrivacy.rawBodiesDetail",
    receiptDetailKey: "settings.aiPrivacy.rawBodiesReceipt",
  },
  {
    labelKey: "settings.aiPrivacy.youtubeDescriptions",
    detailKey: "settings.aiPrivacy.youtubeDescriptionsDetail",
    receiptDetailKey: "settings.aiPrivacy.youtubeDescriptionsReceipt",
  },
  {
    labelKey: "settings.aiPrivacy.providerKeys",
    detailKey: "settings.aiPrivacy.providerKeysDetail",
    receiptDetailKey: "settings.aiPrivacy.providerKeysReceipt",
  },
] as const;

/**
 * Every key that can appear in an outbound AI-classification request, mapped to the
 * disclosure in this panel that accounts for it.
 *
 * `aiPrivacyDisclosureContract.test.ts` reads the real request builders in
 * `aiClassificationService.ts` and fails when a wire field has no entry here, so a new
 * outbound field cannot ship without a matching row, footnote, or glossary sentence.
 */
export const AI_DISCLOSED_WIRE_FIELDS: Readonly<Record<string, TranslationKey>> = {
  id: "settings.aiPrivacy.footnote",
  inputFingerprint: "settings.aiPrivacy.footnote",
  appName: "settings.aiPrivacy.rowApp",
  domain: "settings.aiPrivacy.rowSiteDomain",
  urlHost: "settings.aiPrivacy.rowSiteDomain",
  durationSeconds: "settings.aiPrivacy.rowDuration",
  siteUrl: "settings.aiPrivacy.rowSiteUrl",
  windowTitle: "settings.aiPrivacy.rowWindowTitle",
  title: "settings.aiPrivacy.rowContentContext",
  redditCommunity: "settings.aiPrivacy.rowContentContext",
  youtubeChannelName: "settings.aiPrivacy.rowContentContext",
  youtubeCategory: "settings.aiPrivacy.rowContentContext",
  workProfile: "settings.aiPrivacy.rowWorkProfile",
  memoryContext: "settings.aiPrivacy.rowMemory",
  enhancedContext: "settings.aiPrivacy.meaningEnhancedContext",
} as const;

export type AiPrivacyReviewModel = {
  readonly requiredFields: readonly ControlField[];
  readonly optionalFields: readonly ControlField[];
  readonly handleOptionalChange: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
};

/**
 * Receipt copy for the always-sent rows, keyed by the model's required-field scope.
 * Values are a fixed worked example, never live activity; the receipt heading and the
 * example caption both say so.
 */
const REQUIRED_ROW_COPY: Readonly<Record<string, {
  readonly labelKey: TranslationKey;
  readonly valueKey: TranslationKey;
  readonly meaningKey: TranslationKey;
}>> = {
  app: { labelKey: "settings.aiPrivacy.rowApp", valueKey: "settings.aiPrivacy.valueApp", meaningKey: "settings.aiPrivacy.meaningApp" },
  time: { labelKey: "settings.aiPrivacy.rowDuration", valueKey: "settings.aiPrivacy.valueDuration", meaningKey: "settings.aiPrivacy.meaningDuration" },
  site: { labelKey: "settings.aiPrivacy.rowSiteDomain", valueKey: "settings.aiPrivacy.valueSiteDomain", meaningKey: "settings.aiPrivacy.meaningSiteDomain" },
};

/** Pointer travel beyond this is a drag (a text selection gesture), not a row activation. */
const DRAG_SLOP_PX = 4;

/**
 * The enhanced-context payload only reaches a provider when every gate in
 * contentContextEgressPolicy.decideItem() is open: the production Enhanced context
 * setting and low-confidence retry. Reading them here mirrors what
 * aiClassificationService already reads at request time, so the row reports the state
 * the user is actually in rather than assuming the default.
 */
function enhancedContextCanReachProvider(): boolean {
  if (typeof window === "undefined") return false;
  const settings = resolveInitialEnhancedContextSettings();
  return settings.enabled && settings.retryLowConfidence;
}

/**
 * The Reddit community name survives switching off either row that seems to carry it, so
 * the row being switched off has to name the path that still sends it:
 *
 *   Content context off, Page address on  -> still read from the address
 *   Page address off, Content context on  -> still read from the page/window title
 *
 * With both off, redditCommunityForSegment() returns null and neither row claims anything.
 */
function redditNoteKeyFor(state: {
  readonly contentContextEnabled: boolean;
  readonly enabled: boolean;
  readonly settingKey: keyof AiPrivacyRequestOptionalSettings;
  readonly siteUrlEnabled: boolean;
}): TranslationKey | undefined {
  if (state.enabled) return undefined;
  if (state.settingKey === "contentContext" && state.siteUrlEnabled) return "settings.aiPrivacy.redditNote";
  if (state.settingKey === "siteUrl" && state.contentContextEnabled) return "settings.aiPrivacy.redditNoteTitle";
  return undefined;
}

type OptionalRowCopy = {
  readonly labelKey: TranslationKey;
  readonly valueKey: TranslationKey;
  /** A verifiable limit or scope note, shown while the row is on. */
  readonly noteKey?: TranslationKey;
  /** What classification loses. Shown only while the row is off, because only then is it charged. */
  readonly costKey: TranslationKey;
  readonly meaningKey: TranslationKey;
};

const OPTIONAL_ROW_COPY: Readonly<Record<keyof AiPrivacyRequestOptionalSettings, OptionalRowCopy>> = {
  siteUrl: {
    labelKey: "settings.aiPrivacy.rowSiteUrl",
    valueKey: "settings.aiPrivacy.valueSiteUrl",
    noteKey: "settings.aiPrivacy.noteSiteUrl",
    costKey: "settings.aiPrivacy.costSiteUrl",
    meaningKey: "settings.aiPrivacy.meaningSiteUrl",
  },
  windowTitle: {
    labelKey: "settings.aiPrivacy.rowWindowTitle",
    valueKey: "settings.aiPrivacy.valueWindowTitle",
    noteKey: "settings.aiPrivacy.noteWindowTitle",
    costKey: "settings.aiPrivacy.costWindowTitle",
    meaningKey: "settings.aiPrivacy.meaningWindowTitle",
  },
  contentContext: {
    labelKey: "settings.aiPrivacy.rowContentContext",
    valueKey: "settings.aiPrivacy.valueContentContext",
    noteKey: "settings.aiPrivacy.noteContentContext",
    costKey: "settings.aiPrivacy.costContentContext",
    meaningKey: "settings.aiPrivacy.meaningContentContext",
  },
  workProfile: {
    labelKey: "settings.aiPrivacy.rowWorkProfile",
    valueKey: "settings.aiPrivacy.valueWorkProfile",
    costKey: "settings.aiPrivacy.costWorkProfile",
    meaningKey: "settings.aiPrivacy.meaningWorkProfile",
  },
};

export function useAiPrivacyReviewModel(): AiPrivacyReviewModel {
  const [settings, setSettings] = useState<AiPrivacyRequestSettings>(() => readAiPrivacyRequestSettings());
  const controlFields = useMemo(() => toControlFields(settings), [settings]);
  const requiredFields = useMemo(() => controlFields.filter((field) => field.control === "required"), [controlFields]);
  const optionalFields = useMemo(() => controlFields.filter((field) => field.control === "optional"), [controlFields]);

  useEffect(() => {
    const syncSettings = () => setSettings(readAiPrivacyRequestSettings());
    window.addEventListener("storage", syncSettings);
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    };
  }, []);

  const handleOptionalChange = (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => {
    // saveAiPrivacyRequestSettings dispatches a window event; keep it out of setState updaters (render-phase side effect).
    const nextSettings = updateAiPrivacyRequestOptionalSetting(readAiPrivacyRequestSettings(), key, enabled);
    saveAiPrivacyRequestSettings(nextSettings);
    setSettings(nextSettings);
  };

  return { requiredFields, optionalFields, handleOptionalChange };
}

/**
 * The rows of the "AI data sending" settings group. They are direct children of the
 * group's `.settings-block`, so they share the card edges, dividers and switch of every
 * other settings page: what is always sent, the four fields the user can switch off,
 * what is never sent, then a row that opens the reference text behind all of them.
 */
export function AiDataSendingRows({ onOpenDetails }: { readonly onOpenDetails: () => void }) {
  const { t } = useLocalization();
  const { requiredFields, optionalFields, handleOptionalChange } = useAiPrivacyReviewModel();
  const [statusMessage, setStatusMessage] = useState("");

  const includedOptional = optionalFields.filter((field) => field.enabled).length;
  const siteUrlEnabled = optionalFields.some((field) => field.settingKey === "siteUrl" && field.enabled);
  const contentContextEnabled = optionalFields.some((field) => field.settingKey === "contentContext" && field.enabled);
  const alwaysSent = requiredFields
    .map((field) => REQUIRED_ROW_COPY[field.scope])
    .filter((copy) => copy !== undefined)
    .map((copy) => t(copy.labelKey))
    .join(" · ");

  const toggleOptional = (settingKey: keyof AiPrivacyRequestOptionalSettings, nextEnabled: boolean) => {
    handleOptionalChange(settingKey, nextEnabled);
    const copy = OPTIONAL_ROW_COPY[settingKey];
    const label = t(copy.labelKey);
    const nextCount = includedOptional + (nextEnabled ? 1 : -1);
    const count = t("settings.aiPrivacy.includedCount", { included: nextCount, total: optionalFields.length });
    // The cost line is drawn into the row rather than into the live region, so the
    // announcement has to carry it or switching a field off would announce less than it draws.
    setStatusMessage(
      nextEnabled
        ? t("settings.aiPrivacy.announceAdded", { label }) + " " + count
        : t("settings.aiPrivacy.announceRemoved", { label }) + " " + t(copy.costKey) + " " + count,
    );
  };

  return (
    <>
      <div className="settings-row" data-setting-id="settings.privacy.aiAlways">
        <div>
          <div className="lbl">{t("settings.privacy.aiAlwaysTitle")}</div>
          <div className="desc">{t("settings.privacy.aiAlwaysDescription", { fields: alwaysSent })}</div>
          {/* Lives in the first row because the rows must stay the only children of the
              group: the card's rounded corners come from the first and last row. */}
          <p aria-live="polite" className="ai-privacy-review__status" role="status">
            {statusMessage}
          </p>
        </div>
      </div>

      {optionalFields.map((field) => (
        <OptionalRow
          field={field}
          key={field.detailKey}
          contentContextEnabled={contentContextEnabled}
          siteUrlEnabled={siteUrlEnabled}
          onOptionalChange={toggleOptional}
        />
      ))}

      {/* What is never sent is as important as what is sent, and it is short, so it is
          a plain row. The wording that proves each claim is in the details dialog. */}
      <div className="settings-row" data-setting-id="settings.privacy.aiNeverSent">
        <div>
          <div className="lbl">{t("settings.aiPrivacy.neverSentHeading")}</div>
          <div className="desc">{AI_EXCLUDED_FIELDS.map((field) => t(field.labelKey)).join(" · ")}</div>
        </div>
      </div>

      <div className="settings-row" data-setting-id="settings.privacy.aiDetails">
        <div>
          <div className="lbl">{t("settings.aiPrivacy.detailsHeading")}</div>
          <div className="desc">{t("settings.aiPrivacy.detailsDescription")}</div>
        </div>
        <div className="ctrl">
          <button type="button" className="settings-btn" onClick={onOpenDetails}>
            {t("settings.aiPrivacy.detailsAction")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The reference text behind the AI rows: a worked example request, what each field
 * means, and the wording that proves each never-sent claim. It is long and rarely read,
 * so the settings page opens it in a dialog instead of lengthening itself. It reads the
 * live settings, so the example reflects the switches the user has set.
 */
export function AiPrivacyDetails() {
  const { t } = useLocalization();
  const { requiredFields, optionalFields } = useAiPrivacyReviewModel();
  const enhancedContextOn = enhancedContextCanReachProvider();
  // The Soul digest is only resolved when Work profile is on (classificationMemoryContext.ts),
  // so the recent-activity row has to report a different payload in that state.
  const workProfileEnabled = optionalFields.some((field) => field.settingKey === "workProfile" && field.enabled);

  return (
    <>
      <section className="ai-privacy-review__section">
        <h3 className="ai-privacy-review__section-title">{t("settings.aiPrivacy.exampleRequestHeading")}</h3>
        <p className="ai-privacy-review__lede">{t("settings.aiPrivacy.receiptLede")}</p>
        <p className="ai-privacy-review__caption">{t("settings.aiPrivacy.exampleHeading")}</p>

        <ul className="ai-privacy-review__rows" aria-label={t("settings.aiPrivacy.requiredFieldsAria")}>
          {requiredFields.map((field) => (
            <RequiredReceiptRow field={field} key={field.detailKey} />
          ))}
        </ul>

        <ul className="ai-privacy-review__rows" aria-label={t("settings.aiPrivacy.contextFieldsAria")}>
          <li className="ai-privacy-review__row ai-privacy-review__row--always">
            <div className="ai-privacy-review__row-inner">
              <span className="ai-privacy-review__row-body">
                <span className="ai-privacy-review__row-label">{t("settings.aiPrivacy.rowMemory")}</span>
                <span className="ai-privacy-review__row-value">
                  {t(workProfileEnabled ? "settings.aiPrivacy.valueMemory" : "settings.aiPrivacy.valueMemoryNoProfile")}
                  <small className="ai-privacy-review__row-note">
                    {t(workProfileEnabled ? "settings.aiPrivacy.noteMemory" : "settings.aiPrivacy.noteMemoryNoProfile")}
                  </small>
                </span>
              </span>
              <span className="ai-privacy-review__row-state">{t("settings.aiPrivacy.statePerSegment")}</span>
            </div>
          </li>

          {/* Enhanced context is a real outbound field (localAiProviderRequest promptItem),
              not a variant of Content context. It ships as a bounded retry-only production
              field, so it keeps its own receipt row instead of being folded into Content context. */}
          <li className="ai-privacy-review__row ai-privacy-review__row--always">
            <div className="ai-privacy-review__row-inner">
              <span className="ai-privacy-review__row-body">
                <span className="ai-privacy-review__row-label">{t("settings.aiPrivacy.rowEnhancedContext")}</span>
                <span className="ai-privacy-review__row-value">
                  {t(enhancedContextOn ? "settings.aiPrivacy.valueEnhancedContext" : "settings.aiPrivacy.valueEnhancedContextOff")}
                  <small className="ai-privacy-review__row-note">
                    {t(enhancedContextOn ? "settings.aiPrivacy.noteEnhancedContext" : "settings.aiPrivacy.noteEnhancedContextOff")}
                  </small>
                </span>
              </span>
              <span className="ai-privacy-review__row-state">
                {t(enhancedContextOn ? "settings.aiPrivacy.stateEnhancedContextOn" : "settings.aiPrivacy.stateEnhancedContextOff")}
              </span>
            </div>
          </li>
        </ul>

        {/* One policy per line. The single 371-character paragraph this replaces
            mixed request identifiers, cloud-only additions and sample retention,
            so no individual claim could be found or checked. */}
        <ul className="ai-privacy-review__footnotes">
          <li>{t("settings.aiPrivacy.footnote")}</li>
          <li>{t("settings.aiPrivacy.footnoteCloud")}</li>
          <li>{t("settings.aiPrivacy.footnoteSamples")}</li>
        </ul>
      </section>

      <section className="ai-privacy-review__section">
        <h3 className="ai-privacy-review__section-title">{t("settings.aiPrivacy.glossaryHeading")}</h3>
        <dl className="ai-privacy-review__glossary">
          {requiredFields.map((field) => {
            const copy = REQUIRED_ROW_COPY[field.scope];
            return copy ? (
              <div className="ai-privacy-review__glossary-item" key={field.detailKey}>
                <dt>{t(copy.labelKey)}</dt>
                <dd>{t(copy.meaningKey)}</dd>
              </div>
            ) : null;
          })}
          {optionalFields.map((field) => {
            const copy = field.settingKey ? OPTIONAL_ROW_COPY[field.settingKey] : undefined;
            return copy ? (
              <div className="ai-privacy-review__glossary-item" key={field.detailKey}>
                <dt>{t(copy.labelKey)}</dt>
                <dd>{t(copy.meaningKey)}</dd>
              </div>
            ) : null;
          })}
          <div className="ai-privacy-review__glossary-item">
            <dt>{t("settings.aiPrivacy.rowMemory")}</dt>
            <dd>{t("settings.aiPrivacy.meaningMemory")}</dd>
          </div>
          <div className="ai-privacy-review__glossary-item">
            <dt>{t("settings.aiPrivacy.rowEnhancedContext")}</dt>
            <dd>
              <p>{t("settings.aiPrivacy.meaningEnhancedContext")}</p>
              <p>{t("settings.aiPrivacy.meaningEnhancedContextDetail")}</p>
            </dd>
          </div>
          {/* Project matching is the one surface that also sends what the user
              wrote when defining a project, so it is disclosed here rather
              than left implicit in the shared activity rows. */}
          <div className="ai-privacy-review__glossary-item">
            <dt>{t("settings.aiPrivacy.projectDefinitions")}</dt>
            <dd>{t("settings.aiPrivacy.projectDefinitionsReceipt")}</dd>
          </div>
        </dl>
      </section>

      <section className="ai-privacy-review__section">
        <h3 className="ai-privacy-review__section-title">{t("settings.aiPrivacy.neverSentDetailsHeading")}</h3>
        <dl className="ai-privacy-review__glossary">
          {AI_EXCLUDED_FIELDS.map((field) => (
            <div className="ai-privacy-review__glossary-item" key={field.labelKey}>
              <dt>{t(field.labelKey)}</dt>
              <dd>{t(field.receiptDetailKey)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

function toControlFields(settings: AiPrivacyRequestSettings): readonly ControlField[] {
  return AI_VISIBLE_FIELDS.map((field) => {
    if (field.required) {
      return {
        ...field,
        control: "required",
        enabled: true,
      };
    }

    return {
      ...field,
      control: "optional",
      enabled: optionalSettingEnabled(settings, field),
    };
  });
}

function optionalSettingEnabled(settings: AiPrivacyRequestSettings, field: VisibleField): boolean {
  return field.settingKey ? settings.optional[field.settingKey] : true;
}

function OptionalRow({
  contentContextEnabled,
  field,
  onOptionalChange,
  siteUrlEnabled,
}: {
  readonly contentContextEnabled: boolean;
  readonly field: ControlField;
  readonly onOptionalChange: (key: keyof AiPrivacyRequestOptionalSettings, enabled: boolean) => void;
  readonly siteUrlEnabled: boolean;
}) {
  const { t } = useLocalization();
  const settingKey = field.settingKey;
  const copy = settingKey ? OPTIONAL_ROW_COPY[settingKey] : undefined;
  const enabled = field.enabled;
  const reactId = useId();
  const pressOrigin = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const valueId = "ai-privacy-" + reactId.replace(/:/g, "") + "-value";
  if (!copy || !settingKey) return null;
  const label = t(copy.labelKey);
  // The price is charged only while the row is off, so it is only stated then.
  const cost = enabled ? undefined : t(copy.costKey);
  // redditCommunityForSegment() has two derivation paths, and each survives the other
  // row being off:
  //   address path  — extractRedditCommunityFromUrl(siteUrl), alive while Page address is on
  //   title path    — extractRedditCommunityFromText(siteTitle/windowTitle), alive while
  //                   Content context is on
  // So turning either row off alone still leaks the community, and each row has to say so.
  // (The domain gate means the example segment, developer.mozilla.org, sends nothing here;
  // the rule is stated as a Reddit-scoped note rather than a row state the example never
  // reaches.) Both rows on is already covered by the Content context row's own copy.
  const redditNote = redditNoteKeyFor({ contentContextEnabled, enabled, settingKey, siteUrlEnabled });

  // Whole-row activation without wrapping the value in a <label>: a <label> around
  // selectable text makes a drag across the URL flip the setting (the earlier R2-A bug).
  // A press that travels is a drag, so it selects text and must never toggle — including
  // a drag that happens to land between two text lines and select nothing.
  const handleRowMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    pressOrigin.current = { x: event.clientX, y: event.clientY };
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, a, button, summary")) return;
    if ((window.getSelection()?.toString() ?? "").length > 0) return;
    const origin = pressOrigin.current;
    pressOrigin.current = null;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_SLOP_PX) return;
    onOptionalChange(settingKey, !enabled);
  };

  return (
    <div
      className={"settings-row ai-privacy-review__optional" + (enabled ? "" : " is-off")}
      onClick={handleRowClick}
      onMouseDown={handleRowMouseDown}
    >
      <div>
        <div className="lbl">{label}</div>
        <div className="desc ai-privacy-review__detail" id={valueId}>
          {enabled ? (
            <>
              <span className="ai-privacy-review__example">{t("settings.aiPrivacy.exampleValue", { value: t(copy.valueKey) })}</span>
              {copy.noteKey ? <span className="ai-privacy-review__row-note">{t(copy.noteKey)}</span> : null}
            </>
          ) : null}
          {cost ? (
            <span className="ai-privacy-review__row-cost">
              <span aria-hidden="true" className="ai-privacy-review__cost-mark" />
              {cost}
            </span>
          ) : null}
          {redditNote ? <span className="ai-privacy-review__row-note">{t(redditNote)}</span> : null}
        </div>
      </div>
      <div className="ctrl ai-privacy-review__control">
        {/* An on switch already reads as "sent"; repeating the word next to every
            row added a second state vocabulary without adding information. Only the
            held-back state, which the switch alone understates, keeps a word. */}
        {enabled ? null : (
          <span aria-hidden="true" className="ai-privacy-review__row-state">
            {t("settings.aiPrivacy.stateHeld")}
          </span>
        )}
        <Toggle
          ariaDescribedBy={enabled ? undefined : valueId}
          ariaLabel={label}
          checked={enabled}
          onChange={(next) => onOptionalChange(settingKey, next)}
        />
      </div>
    </div>
  );
}

function RequiredReceiptRow({ field }: { readonly field: ControlField }) {
  const { t } = useLocalization();
  const copy = REQUIRED_ROW_COPY[field.scope];
  if (!copy) return null;
  return (
    <li className="ai-privacy-review__row ai-privacy-review__row--always">
      <div className="ai-privacy-review__row-inner">
        <span className="ai-privacy-review__row-body">
          <span className="ai-privacy-review__row-label">{t(copy.labelKey)}</span>
          <span className="ai-privacy-review__row-value">{t(copy.valueKey)}</span>
        </span>
        <span className="ai-privacy-review__row-state">{t("settings.aiPrivacy.stateAlways")}</span>
      </div>
    </li>
  );
}
