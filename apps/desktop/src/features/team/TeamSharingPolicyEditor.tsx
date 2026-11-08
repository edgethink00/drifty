import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { Toggle } from "../../components/Toggle";
import { useLocalization } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { TranslationKey } from "../localization/translations";
import { SettingsSelect } from "../settings/SettingsSelect";
import {
  TEAM_SHARE_FIELDS,
  TEAM_SHARE_LEVELS_BY_FIELD,
  TEAM_SHARING_PRESETS,
  TEAM_WORK_SHARE_LEVELS,
  applySharingPreset,
  focusSharedIn,
  levelAboveCeiling,
  matchingSharingPreset,
  policyWithinCeiling,
  shareLevelRank,
  withFocusShared,
  withWorkShareLevel,
  workShareLevelAllowed,
  workShareLevelOf,
  type TeamShareField,
  type TeamShareLevel,
  type TeamSharingPolicy,
  type TeamSharingPolicyDraft,
  type TeamSharingPresetId,
  type TeamSharingWindow,
  type TeamWorkShareLevel, withWorkTitles, workTitlesSharedIn } from "./teamSharingPolicy";
import { TEAM_SHARING_EDITOR } from "./teamPreviewScenarios";
import { TEAM_LOCAL_TIMEZONE, computerTimeZone, type TeamTrackingPolicy } from "./teamSharingScope";

type Translate = ReturnType<typeof useLocalization>["t"];

export const SHARE_LEVEL_KEYS: Readonly<Record<TeamShareLevel, TranslationKey>> = {
  off: "team.policy.level.off",
  team: "team.policy.level.team",
  member_daily: "team.policy.level.memberDaily",
  hourly: "team.policy.level.hourly",
};

export const SHARE_FIELD_KEYS: Readonly<Record<TeamShareField, { readonly title: TranslationKey }>> = {
  projects: { title: "team.policy.field.projects" },
  tasks: { title: "team.policy.field.tasks" },
  focus: { title: "team.policy.field.focus" },
};

export const PRESET_KEYS: Readonly<Record<TeamSharingPresetId, { readonly title: TranslationKey; readonly body: TranslationKey }>> = {
  project_totals: { title: "team.policy.preset.projectTotals", body: "team.policy.preset.projectTotalsBody" },
  work_log: { title: "team.policy.preset.workLog", body: "team.policy.preset.workLogBody" },
  work_and_focus: { title: "team.policy.preset.workAndFocus", body: "team.policy.preset.workAndFocusBody" },
  full_timeline: { title: "team.policy.preset.fullTimeline", body: "team.policy.preset.fullTimelineBody" },
};

/** Columns run from nothing to the most detail, so further right always shows more. */
const MATRIX_LEVELS: readonly TeamShareLevel[] = ["off", "team", "member_daily", "hourly"];

export function LockIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
  );
}

const SAMPLE_PROJECT = { name: "Q4 Campaign", color: "#5b7a3d" } as const;
const SAMPLE_SECONDS = {
  // Whole hours for the team total, so the example keeps to one line in its column.
  teamProjects: 38 * 3600,
  dayProjects: 3 * 3600 + 10 * 60,
  teamFocus: 101 * 3600 + 40 * 60,
  dayFocus: 2 * 3600 + 40 * 60,
} as const;

/** What a manager would read in one cell: the item at that level, from one sample week. */
function cellExample(field: TeamShareField, level: TeamShareLevel, language: DisplayLanguage, t: Translate): { readonly text: string; readonly project: boolean } | null {
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  if (level === "off") return null;
  if (field === "projects") {
    if (level === "team") return { text: SAMPLE_PROJECT.name + " " + duration(SAMPLE_SECONDS.teamProjects), project: true };
    if (level === "member_daily") return { text: SAMPLE_PROJECT.name + " " + duration(SAMPLE_SECONDS.dayProjects), project: true };
    return { text: "09:10 " + SAMPLE_PROJECT.name, project: true };
  }
  if (field === "tasks") {
    return { text: (level === "hourly" ? "09:10 " : "") + t("team.policy.sample.task1"), project: false };
  }
  if (level === "team") return { text: t("team.policy.sample.focus", { duration: duration(SAMPLE_SECONDS.teamFocus) }), project: false };
  if (level === "member_daily") return { text: t("team.policy.sample.focus", { duration: duration(SAMPLE_SECONDS.dayFocus) }), project: false };
  return { text: "09:10–10:40 " + t("team.policy.sample.focusBlock"), project: false };
}

export const WORK_LEVEL_KEYS: Readonly<Record<TeamWorkShareLevel, { readonly title: TranslationKey; readonly body: TranslationKey }>> = {
  hourly: { title: "team.policy.short.hourly", body: "team.policy.short.hourlyBody" },
  member_daily: { title: "team.policy.short.memberDaily", body: "team.policy.short.memberDailyBody" },
  team: { title: "team.policy.short.team", body: "team.policy.short.teamBody" },
};

/** What a manager would read under one work-record choice, from the same sample week as the table. */
function workExample(level: TeamWorkShareLevel, language: DisplayLanguage, t: Translate): string {
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  if (level === "hourly") return "09:10 " + SAMPLE_PROJECT.name + " · " + t("team.policy.sample.task1");
  if (level === "member_daily") return SAMPLE_PROJECT.name + " " + duration(SAMPLE_SECONDS.dayProjects) + " · " + t("team.policy.sample.task1");
  return SAMPLE_PROJECT.name + " " + duration(SAMPLE_SECONDS.teamProjects);
}

type ShortFormProps = {
  readonly draft: TeamSharingPolicyDraft;
  readonly set: (next: TeamSharingPolicyDraft) => void;
  readonly editable: boolean;
  readonly idPrefix: string;
  readonly ceiling: TeamSharingPolicy | null;
};

/** One Settings switch row: the title and what it does on the left, the switch on the right. */
function ToggleRow({ id, title, hint, checked, disabled, onChange, nested = false }: {
  readonly nested?: boolean;
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <div className={"team-policy__toggle-row" + (nested ? " is-nested" : "") + (disabled ? " is-disabled" : "")}>
      <div className="team-policy__members-copy">
        <span id={id} className="team-set-permission__title">{title}</span>
        <p id={id + "-hint"} className="team-modal__hint">{hint}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} ariaLabel={title} ariaDescribedBy={id + "-hint"} />
    </div>
  );
}

/**
 * The sharing form (owner decision 2026-10-20, C): flat Settings switches,
 * as Rize's feature switches are, each saying in full what it shows. Times of
 * day need each person's records, so turning them on turns those on too and
 * turning those off turns times of day off; neither switch waits on the other.
 * What managers see comes first; what members see follows on its own.
 */
function TeamSharingToggleForm({ draft, set, editable, idPrefix, ceiling }: ShortFormProps): JSX.Element {
  const { t } = useLocalization();
  const work = workShareLevelOf(draft);
  const rank = shareLevelRank(draft.projects);
  const perPerson = rank >= 2;
  const byTime = rank >= 3;
  const focusOn = focusSharedIn(draft) === true;
  const focusCapped = ceiling !== null && ceiling.focus === "off";
  const summaryCapped = ceiling !== null && !ceiling.memberSummary;
  // Under a ceiling a switch that may not turn on says so in its description.
  const personCapped = !perPerson && !workShareLevelAllowed("member_daily", ceiling);
  const timeCapped = !byTime && !workShareLevelAllowed("hourly", ceiling);
  return (
    <>
      <div className="team-policy__members team-policy__toggles">
        <ToggleRow
          id={idPrefix + "-person"}
          title={t("team.policy.toggle.perPerson")}
          hint={personCapped ? t("team.decide.aboveCeiling") : work === "custom" ? t("team.policy.short.custom") : t("team.policy.toggle.perPersonBody")}
          checked={perPerson}
          disabled={!editable || personCapped}
          onChange={(on) => set(withWorkShareLevel(draft, on ? "member_daily" : "team", ceiling))}
        />
        <ToggleRow
          id={idPrefix + "-titles"}
          nested
          title={t("team.policy.toggle.titles")}
          hint={t("team.policy.toggle.titlesBody")}
          checked={perPerson && workTitlesSharedIn(draft)}
          disabled={!editable || !perPerson || (ceiling !== null && ceiling.tasks === "off" && !workTitlesSharedIn(draft))}
          onChange={(on) => set(withWorkTitles(draft, on, ceiling))}
        />
        <ToggleRow
          id={idPrefix + "-time"}
          title={t("team.policy.toggle.byTime")}
          hint={timeCapped ? t("team.decide.aboveCeiling") : t("team.policy.toggle.byTimeBody")}
          checked={byTime}
          disabled={!editable || timeCapped}
          onChange={(on) => set(withWorkShareLevel(draft, on ? "hourly" : "member_daily", ceiling))}
        />
        <ToggleRow
          id={idPrefix + "-focus"}
          title={t("team.policy.short.focus")}
          hint={!focusOn && focusCapped ? t("team.decide.aboveCeiling") : t("team.policy.toggle.focusBody")}
          checked={focusOn}
          disabled={!editable || (!focusOn && focusCapped)}
          onChange={(on) => set(withFocusShared(draft, on, ceiling))}
        />
      </div>
      <div className="team-policy__members team-policy__toggles">
        <ToggleRow
          id={idPrefix + "-summary"}
          title={t("team.policy.memberSummary")}
          hint={!draft.memberSummary && summaryCapped ? t("team.decide.aboveCeiling") : t("team.policy.toggle.summaryBody")}
          checked={draft.memberSummary === true}
          disabled={!editable || (!draft.memberSummary && summaryCapped)}
          onChange={(on) => set({ ...draft, memberSummary: on })}
        />
      </div>
    </>
  );
}

/**
 * The short form (owner decision 2026-10-20): one choice for the work record,
 * where project time and work titles move together, and one switch for focus,
 * which follows the work record's detail. Each card shows what a manager reads.
 */
function TeamSharingShortForm({ draft, set, editable, idPrefix, ceiling }: ShortFormProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const work = workShareLevelOf(draft);
  const focusOn = focusSharedIn(draft);
  const focusExample = focusOn && draft.focus ? cellExample("focus", draft.focus, language, t) : null;
  return (
    <>
      {renderWork()}
      <div className="team-policy__members team-policy__choice">
        <div className="team-policy__members-copy">
          <span id={idPrefix + "-focus"} className="team-set-permission__title">{t("team.policy.short.focus")}</span>
          <p className="team-modal__hint">{focusOn ? t("team.policy.short.focusOnBody") : t("team.policy.short.focusOffBody")}</p>
          {focusExample ? <p className="team-policy__example"><span>{focusExample.text}</span></p> : null}
        </div>
        <div className="team-seg team-policy__seg" role="radiogroup" aria-labelledby={idPrefix + "-focus"}>
          {([false, true] as const).map((value) => {
            const on = focusOn === value;
            const capped = value && ceiling !== null && ceiling.focus === "off";
            return (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "on" : undefined}
                disabled={!editable || capped}
                title={capped ? t("team.decide.aboveCeiling") : undefined}
                onClick={() => set(withFocusShared(draft, value, ceiling))}
              >
                <span>{value ? t("team.policy.short.focusOn") : t("team.policy.short.focusOff")}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  function renderWork(): JSX.Element {
    return (
      <div className="team-policy__members team-policy__choice">
        <div className="team-policy__members-copy">
          <span id={idPrefix + "-work"} className="team-set-permission__title">{t("team.policy.short.work")}</span>
          <p className="team-modal__hint">{work === "custom" ? t("team.policy.short.custom") : work ? t(WORK_LEVEL_KEYS[work].body) : null}</p>
          {work && work !== "custom" ? (
            <p className="team-policy__example">
              <span className="team-policy-chip__dot" style={{ background: SAMPLE_PROJECT.color }} aria-hidden="true" />
              <span>{workExample(work, language, t)}</span>
            </p>
          ) : null}
        </div>
        <div className="team-seg team-policy__seg" role="radiogroup" aria-labelledby={idPrefix + "-work"}>
          {TEAM_WORK_SHARE_LEVELS.map((level) => {
            const on = work === level;
            const allowed = workShareLevelAllowed(level, ceiling);
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "on" : undefined}
                disabled={!editable || !allowed}
                title={allowed ? undefined : t("team.decide.aboveCeiling")}
                onClick={() => set(withWorkShareLevel(draft, level, ceiling))}
              >
                <span>{t(WORK_LEVEL_KEYS[level].title)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
}

export type TeamSharingPolicyEditorProps = {
  readonly draft: TeamSharingPolicyDraft;
  /** Absent for a read-only view, as members see it. */
  readonly onChange?: (next: TeamSharingPolicyDraft) => void;
  readonly disabled?: boolean;
  readonly idPrefix: string;
  /** The most this editor may choose (a manager under a ceiling); cells above it stay locked. */
  readonly ceiling?: TeamSharingPolicy | null;
  /**
   * Decision candidate D, for the organization admin: per item, lock it for
   * every team or leave it to team managers. Absent elsewhere.
   */
  readonly delegation?: { readonly fields: readonly TeamShareField[]; readonly onChange: (fields: readonly TeamShareField[]) => void } | null;
  /** Candidate D, for a manager: items an organization admin locked, whose row cannot change. */
  readonly lockedFields?: readonly TeamShareField[];
};

/**
 * One table: what is shared down the side, how much detail across the top.
 * A choice includes every column to its left, and each cell shows what a
 * manager would read there, so the table is its own preview. Combinations only
 * fill the table. Nothing is chosen until the admin chooses it. The headings
 * carry no explanations: the shading and the examples already say it.
 */
export function TeamSharingPolicyEditor({ draft, onChange, disabled = false, idPrefix, ceiling = null, delegation = null, lockedFields = [] }: TeamSharingPolicyEditorProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const editable = Boolean(onChange) && !disabled;
  const preset = matchingSharingPreset(draft);
  const set = (next: TeamSharingPolicyDraft) => {
    if (editable) onChange?.(next);
  };
  const membersCard = (
    <div className="team-policy__members">
      <div className="team-policy__members-copy">
        <span id={idPrefix + "-summary"} className="team-set-permission__title">{t("team.policy.membersTitle")}</span>
        <p className="team-modal__hint">{t("team.policy.memberSummaryHint")}</p>
      </div>
      <div className="team-seg team-policy__seg" role="radiogroup" aria-labelledby={idPrefix + "-summary"}>
        {([false, true] as const).map((value) => {
          const on = draft.memberSummary === value;
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "on" : undefined}
              disabled={!editable || (value && ceiling !== null && !ceiling.memberSummary)}
              onClick={() => set({ ...draft, memberSummary: value })}
            >
              <span>{value ? t("team.policy.memberSummaryOn") : t("team.policy.memberSummaryOff")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  // The short form, unless an organization admin is locking items one by one (candidate D).
  const form = TEAM_SHARING_EDITOR.read();
  if (form === "toggles" && !delegation && lockedFields.length === 0) {
    return (
      <div className="team-policy team-policy--short">
        <TeamSharingToggleForm draft={draft} set={set} editable={editable} idPrefix={idPrefix} ceiling={ceiling} />
      </div>
    );
  }
  if (form === "switch" && !delegation && lockedFields.length === 0) {
    return (
      <div className="team-policy team-policy--short">
        <TeamSharingShortForm draft={draft} set={set} editable={editable} idPrefix={idPrefix} ceiling={ceiling} />
        {membersCard}
      </div>
    );
  }

  return (
    <div className="team-policy">
      <div className="team-policy__quick" role="group" aria-labelledby={idPrefix + "-quick"}>
        <span className="label-mono" id={idPrefix + "-quick"}>{t("team.policy.presets")}</span>
        {TEAM_SHARING_PRESETS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="team-policy__quick-btn"
            aria-pressed={preset === candidate.id}
            title={t(PRESET_KEYS[candidate.id].body)}
            disabled={!editable || (ceiling !== null && !policyWithinCeiling({ ...draft, projects: candidate.projects, tasks: candidate.tasks, focus: candidate.focus }, ceiling))}
            onClick={() => set(applySharingPreset(draft, candidate.id))}
          >
            {t(PRESET_KEYS[candidate.id].title)}
          </button>
        ))}
      </div>

      <div className="team-matrix" role="group" aria-label={t("team.policy.matrixAria")}>
        <div className="team-matrix__head" aria-hidden="true">
          <span className="team-matrix__corner label-mono">{t("team.policy.matrixTitle")}</span>
          {MATRIX_LEVELS.map((level) => (
            <span key={level} className="team-matrix__col">
              <strong>{t(SHARE_LEVEL_KEYS[level])}</strong>
            </span>
          ))}
        </div>
        {TEAM_SHARE_FIELDS.map((field) => {
          const labelId = idPrefix + "-" + field;
          const selected = draft[field];
          const rank = shareLevelRank(selected);
          const locked = lockedFields.includes(field);
          const delegated = delegation ? delegation.fields.includes(field) : false;
          return (
            <div key={field} className={"team-matrix__row" + (selected === null ? " is-unset" : "") + (locked ? " is-locked" : "")} role="radiogroup" aria-labelledby={labelId}>
              <div className="team-matrix__label">
                <span id={labelId} className="team-set-permission__title">
                  {locked ? <span className="team-matrix__lock" title={t("team.decide.lockedByAdmin")}><LockIcon /></span> : null}
                  {t(SHARE_FIELD_KEYS[field].title)}
                </span>
                {locked ? <small>{t("team.decide.lockedByAdmin")}</small> : null}
                {delegation ? (
                  <span className="team-matrix__delegate" role="group" aria-label={t("team.decide.delegateAria", { item: t(SHARE_FIELD_KEYS[field].title) })}>
                    {([false, true] as const).map((leave) => (
                      <button
                        key={String(leave)}
                        type="button"
                        aria-pressed={delegated === leave}
                        className={delegated === leave ? "on" : undefined}
                        disabled={!editable}
                        onClick={() => delegation.onChange(leave ? [...delegation.fields.filter((item) => item !== field), field] : delegation.fields.filter((item) => item !== field))}
                      >
                        {leave ? null : <LockIcon />}
                        {leave ? t("team.decide.delegateLeave") : t("team.decide.delegateLock")}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              {MATRIX_LEVELS.map((level) => {
                if (!TEAM_SHARE_LEVELS_BY_FIELD[field].includes(level)) {
                  return (
                    <span key={level} className="team-matrix__cell is-na" title={t("team.policy.notApplicable")}>
                      <span className="team-matrix__cell-level" aria-hidden="true">{t(SHARE_LEVEL_KEYS[level])}</span>
                      <span className="team-matrix__na">{t("team.policy.notApplicable")}</span>
                    </span>
                  );
                }
                const checked = selected === level;
                const included = selected !== null && level !== "off" && shareLevelRank(level) <= rank;
                const example = cellExample(field, level, language, t);
                const capped = (ceiling !== null && levelAboveCeiling(level, ceiling[field])) || (locked && !checked);
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={t(SHARE_LEVEL_KEYS[level]) + (example ? " · " + example.text : "")}
                    className={"team-matrix__cell" + (level === "off" ? " is-off" : "") + (included ? " is-included" : "") + (checked ? " is-selected" : "") + (capped ? " is-capped" : "")}
                    disabled={!editable || capped}
                    title={locked && !checked ? t("team.decide.lockedByAdmin") : capped ? t("team.decide.aboveCeiling") : undefined}
                    onClick={() => set({ ...draft, [field]: level })}
                  >
                    <span className="team-matrix__cell-level" aria-hidden="true">{t(SHARE_LEVEL_KEYS[level])}</span>
                    {example ? (
                      <span className="team-matrix__example">
                        {example.project ? <span className="team-policy-chip__dot" style={{ background: SAMPLE_PROJECT.color }} aria-hidden="true" /> : null}
                        <span>{example.text}</span>
                      </span>
                    ) : (
                      <span className="team-matrix__example team-matrix__example--private"><LockIcon /></span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {delegation ? <p className="team-modal__hint team-matrix__delegate-hint">{t("team.decide.delegateAdminHint")}</p> : null}
      {membersCard}
    </div>
  );
}

export function clockLabel(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
}

const CLOCK_OPTIONS = Array.from({ length: 37 }, (_, index) => 5 * 60 + index * 30).map((minute) => ({ value: String(minute), label: clockLabel(minute) }));

/** ISO weekday 1 (Monday) … 7 (Sunday), as the display language writes it short. */
export function weekdayShortLabel(isoWeekday: number, language: DisplayLanguage): string {
  const locale = language === "zh-Hans" ? "zh-CN" : language;
  // 2026-01-05 is a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + isoWeekday)));
}

/** "Korean Standard Time" for a schedule's zone, as the display language names it; the zone id when it cannot. */
export function timeZoneLabel(zone: string, language: DisplayLanguage): string {
  const locale = language === "zh-Hans" ? "zh-CN" : language;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

export type TeamSharingWindowEditorProps = {
  readonly window: TeamSharingWindow;
  readonly onWindowChange?: (next: TeamSharingWindow) => void;
  readonly tracking: TeamTrackingPolicy | null;
  readonly onTrackingChange?: (next: TeamTrackingPolicy) => void;
  readonly disabled?: boolean;
  readonly idPrefix: string;
  /** A Dev preview candidate: the hours say whose clock they follow, the team's or each person's. */
  readonly zoneChoice?: boolean;
};

/**
 * The team's recording hours and whether members may pause inside them, one row per setting with its
 * name and note on the left and a compact control on the right, as Linear's team permissions and Rize's
 * team settings lay out settings (owner choice 2026-10-19). Team creation uses the same rows.
 */
export function TeamSharingWindowEditor({ window, onWindowChange, tracking, onTrackingChange, disabled = false, idPrefix, zoneChoice = false }: TeamSharingWindowEditorProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  const editable = Boolean(onWindowChange) && !disabled;
  const toggleDay = (day: number) => {
    if (!editable) return;
    const days = window.days.includes(day) ? window.days.filter((value) => value !== day) : [...window.days, day].sort((left, right) => left - right);
    onWindowChange?.({ ...window, days });
  };
  const invalid = window.days.length === 0 || window.start_minute >= window.end_minute;
  const trackingOptions: readonly { readonly id: TeamTrackingPolicy; readonly title: TranslationKey; readonly body: TranslationKey }[] = [
    { id: "free", title: "team.policy.tracking.free", body: "team.policy.tracking.freeHint" },
    { id: "managed", title: "team.policy.tracking.managed", body: "team.policy.tracking.managedHint" },
  ];

  const local = window.timezone === TEAM_LOCAL_TIMEZONE;
  const here = computerTimeZone();
  const teamZone = local ? here : window.timezone;
  // The team's clock as stored, and this computer's, so hours saved on another clock (UTC, say) can be moved.
  const zoneOptions = [...new Set([teamZone, here])];
  const trackingChoice = trackingOptions.find((option) => option.id === tracking) ?? null;
  return (
    <div className="team-form-rows">
      <div className="team-form-row">
        <div className="team-form-row__copy"><strong id={idPrefix + "-days"}>{t("team.policy.rows.days")}</strong></div>
        <div className="team-form-row__control">
          <div className="team-window__days" role="group" aria-labelledby={idPrefix + "-days"}>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => {
              const on = window.days.includes(day);
              return (
                <button key={day} type="button" className={"team-window__day" + (on ? " is-on" : "")} aria-pressed={on} disabled={!editable} onClick={() => toggleDay(day)}>
                  {weekdayShortLabel(day, language)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="team-form-row">
        <div className="team-form-row__copy">
          <strong>{t("team.policy.rows.hours")}</strong>
          <span className={invalid ? "team-window__invalid" : undefined}>{invalid ? t("team.policy.window.invalid") : t("team.policy.window.hint")}</span>
        </div>
        <div className="team-form-row__control team-window__times">
          <SettingsSelect ariaLabel={t("team.policy.window.start")} className="team-window__time" value={String(window.start_minute)} options={CLOCK_OPTIONS} disabled={!editable} onChange={(value) => onWindowChange?.({ ...window, start_minute: Number(value) })} />
          <span className="team-window__dash" aria-hidden="true">–</span>
          <SettingsSelect ariaLabel={t("team.policy.window.end")} className="team-window__time" value={String(window.end_minute)} options={CLOCK_OPTIONS} disabled={!editable} onChange={(value) => onWindowChange?.({ ...window, end_minute: Number(value) })} />
        </div>
      </div>
      {!zoneChoice && !local ? (
        <div className="team-form-row">
          <div className="team-form-row__copy">
            <strong>{t("team.policy.window.timeZone")}</strong>
            <span>{t("team.policy.window.zoneTeamHint")}</span>
          </div>
          <div className="team-form-row__control">
            <SettingsSelect
              ariaLabel={t("team.policy.window.timeZone")}
              className="team-form-row__select"
              value={teamZone}
              disabled={!editable}
              options={zoneOptions.map((zone) => ({ value: zone, label: timeZoneLabel(zone, language) }))}
              onChange={(zone) => onWindowChange?.({ ...window, timezone: zone })}
            />
          </div>
        </div>
      ) : null}
      {zoneChoice ? (
        <div className="team-form-row">
          <div className="team-form-row__copy">
            <strong>{t("team.policy.window.zone")}</strong>
            <span>{local ? t("team.policy.window.zoneLocalHint") : t("team.policy.window.zoneTeamHint")}</span>
          </div>
          <div className="team-form-row__control">
            <SettingsSelect
              ariaLabel={t("team.policy.window.zone")}
              className="team-form-row__select"
              value={local ? "local" : "team"}
              disabled={!editable}
              options={[
                { value: "team", label: t("team.policy.window.zoneTeam", { zone: timeZoneLabel(teamZone, language) }) },
                { value: "local", label: t("team.policy.window.zoneLocal") },
              ]}
              onChange={(mode) => onWindowChange?.({ ...window, timezone: mode === "local" ? TEAM_LOCAL_TIMEZONE : teamZone })}
            />
          </div>
        </div>
      ) : null}
      <div className="team-form-row">
        <div className="team-form-row__copy">
          <strong>{t("team.policy.tracking.title")}</strong>
          {trackingChoice ? <span>{t(trackingChoice.body)}</span> : null}
        </div>
        <div className="team-form-row__control">
          <SettingsSelect<string>
            ariaLabel={t("team.policy.tracking.title")}
            className="team-form-row__select"
            value={tracking ?? ""}
            placeholder={t("team.policy.rows.choose")}
            disabled={!onTrackingChange || disabled}
            options={trackingOptions.map((option) => ({ value: option.id, label: t(option.title) }))}
            onChange={(value) => onTrackingChange?.(value as TeamTrackingPolicy)}
          />
        </div>
      </div>
    </div>
  );
}
