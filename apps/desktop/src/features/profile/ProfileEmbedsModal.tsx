// Embeds modal (prototype "embeds v2"): a focused overlay opened from the Leaderboard
// presence hero. Left column = a single live preview stage + its copy-paste snippets;
// right rail = what's public (publish master + the real detail-share scopes), the format
// picker, and per-format options (badge theme, card range).
//
// Everything here is wired to REAL capabilities only: theme (light/dark), card range
// (7/30), the four working formats (badge/card/chart/data), and the three focus-card
// detail flags. The "Hourly focus rhythm" flag is the aggregate-timeline scope — 24
// hourly averages, never raw session start/end times — so no raw timeline is ever
// published from here.
import { useEffect, useMemo, useState } from "react";
import { formatFocusDuration, renderFocusBadgeSvg, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets } from "../share/embedSnippets";
import type { BadgeThemeOption, CardRangeOption } from "../share/embedSnippets";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import type { FocusCardDetailFlags } from "../share/focusCardService";
import { buildPublicProfileUrl, copyTextToClipboard, type ProfileDraft } from "./ProfileModals";
import { buildEmbedGroups, SnippetCopyRow, summarizeDailyProductivity } from "./ProfileEmbedGroups";

type FormatKey = "badge" | "card" | "chart" | "data";

const FORMAT_META: ReadonlyArray<{ readonly key: FormatKey; readonly label: string; readonly desc: string }> = [
  { key: "badge", label: "Badge", desc: "Weekly total pill" },
  { key: "card", label: "Card", desc: "Rich focus card" },
  { key: "chart", label: "Chart", desc: "30-day bars" },
  { key: "data", label: "Data", desc: "Aggregate JSON" },
];

// Real detail-share scopes. "Hourly focus rhythm" is the aggregate timeline — 24 averages,
// never raw sessions — so it is safe to publish behind this opt-in toggle.
const SCOPE_DEFS: ReadonlyArray<{
  readonly key: keyof FocusCardDetailFlags;
  readonly label: string;
  readonly desc: string;
  readonly warning: string | null;
}> = [
  { key: "shareCategoryBreakdown", label: "Category breakdown", desc: "7-day totals per category — no app names or titles.", warning: null },
  { key: "shareHourlyPattern", label: "Hourly rhythm", desc: "Average focus per hour of day — 24 averages, not a session timeline.", warning: null },
  { key: "shareTopApps", label: "Top apps", desc: "Your top 5 apps this week (15 min+ each).", warning: "Makes those app names public." },
];

export type ProfileEmbedsModalProps = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly displayName: string;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly publicId: string | null;
  /** Gates the optional detail-share scopes (category / hourly / top-apps), matching the
   *  existing Dev-preview gating; the base weekly+daily publish is always available. */
  readonly webAccountPreview?: boolean;
  readonly onClose: () => void;
  readonly onCopyProfileLink: () => void;
  readonly onEditProfile: () => void;
};

export function ProfileEmbedsModal({
  card,
  dailyProductivity,
  displayName,
  draft,
  focusSeconds7d,
  publicId,
  webAccountPreview = false,
  onClose,
  onCopyProfileLink,
  onEditProfile,
}: ProfileEmbedsModalProps) {
  const [activeFormat, setActiveFormat] = useState<FormatKey>("badge");
  const [embedTheme, setEmbedTheme] = useState<BadgeThemeOption>("light");
  const [cardRange, setCardRange] = useState<CardRangeOption>(7);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the real publish state on open — `card.enabled` is null until the first
  // refresh, and without this the modal would show the lock overlay for a card
  // that is actually live (the only other refresh trigger is the account menu).
  const { refresh: refreshCard } = card;
  useEffect(() => {
    void refreshCard();
  }, [refreshCard]);

  const cardLocked = card.enabled !== true;
  const chartStats = useMemo(() => summarizeDailyProductivity(dailyProductivity), [dailyProductivity]);
  const snippets = publicId ? buildEmbedSnippets(publicId, { theme: embedTheme, range: cardRange }) : null;
  const publicProfileUrl = publicId ? buildPublicProfileUrl(publicId) : null;

  const badgeSrcFor = (theme: BadgeThemeOption) => {
    const svg = renderFocusBadgeSvg({
      value: focusSeconds7d > 0 ? formatFocusDuration(focusSeconds7d) : "—",
      theme,
      accent: card.enabled === true && focusSeconds7d > 0 ? FOCUS_GREEN : AWAY_GREY,
    });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const groups = useMemo(
    () =>
      snippets
        ? buildEmbedGroups({
            badgeSrcFor,
            cardLocked,
            cardRange,
            chartStats,
            dailyProductivity,
            displayName,
            draft,
            embedTheme,
            focusSeconds7d,
            setCardRange,
            setEmbedTheme,
            snippets,
          })
        : [],
    // badgeSrcFor is a stable-enough closure over the same inputs already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snippets, cardLocked, cardRange, chartStats, dailyProductivity, displayName, draft, embedTheme, focusSeconds7d],
  );

  const copy = async (key: string, text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
    } catch {
      // Clipboard failures are non-fatal and handled locally so this
      // fire-and-forget path does not emit a noisy global rejection.
      setCopiedKey(null);
    }
  };

  const activeGroup = groups.find((group) => group.key === activeFormat) ?? null;
  const activeVariants =
    activeFormat === "data"
      ? snippets
        ? [{ key: "data", label: "GET · JSON", snippet: snippets.dataUrl }]
        : []
      : activeGroup?.variants ?? [];
  const stageIsDark = activeFormat === "badge" && embedTheme === "dark";
  const publishPillText = card.enabled === true ? "Live" : card.enabled === null ? "…" : "Private";
  const publishPillClass = `profile-state-pill${card.enabled === true ? " profile-state-pill--on" : card.enabled === null ? " profile-state-pill--pending" : ""}`;

  const copyInputClassName = "settings-input profile-field profile-field--code profile-embed-card__code";
  const copyRowClassName = "profile-copy-row profile-embed-card__variant-row";
  const primaryButtonClassName = "settings-btn settings-btn--primary profile-btn";

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal profile-modal profile-embeds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="embeds-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="profile-modal__x" aria-label="Close embeds" onClick={onClose}>×</button>
        <div className="profile-modal__header">
          <div className="profile-modal__avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="m8 8-4.5 4L8 16" />
              <path d="m16 8 4.5 4L16 16" />
              <path d="m13.2 5.5-2.4 13" />
            </svg>
          </div>
          <div>
            <span className="label-mono">Share</span>
            <h2 id="embeds-modal-title">Embeds</h2>
            <p>Badge, card, chart, JSON — auto-updating with your public data.</p>
          </div>
        </div>

        {!snippets ? (
          <div className="profile-embeds-modal__body">
            <div className="profile-embeds__setup">
              <p className="profile-note">Save your profile once to mint your public link, then your embeds appear here.</p>
              {/* Close this modal before opening the editor — otherwise they stack and the
                  window-level Escape listener here would close the one underneath. */}
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={() => {
                  onClose();
                  onEditProfile();
                }}
              >
                Set up profile
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-embeds-modal__body">
            <div className="embeds-layout">
              <div className="embeds-main">
                <div className="embeds-topbar">
                  <span className="label-mono" style={{ flex: "0 0 auto" }}>Public page</span>
                  {card.enabled === true && publicProfileUrl ? (
                    <div className={copyRowClassName} style={{ flex: 1 }}>
                      <input
                        className={copyInputClassName}
                        readOnly
                        value={publicProfileUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button type="button" className={primaryButtonClassName} aria-label="Copy profile link" onClick={onCopyProfileLink}>
                        Copy
                      </button>
                    </div>
                  ) : (
                    <span className="embeds-rail__hint">Off — your public page link appears here once your card is public.</span>
                  )}
                </div>

                <div className={`embeds-stage${stageIsDark ? " embeds-stage--dark" : ""}`} aria-label="Embed preview">
                  <div className="embeds-stage__inner">
                    {activeFormat === "data" ? (
                      <pre className="embeds-data-preview">{buildDataPreview(chartStats)}</pre>
                    ) : (
                      activeGroup?.preview ?? null
                    )}
                  </div>
                </div>

                <div className={cardLocked ? "embeds-snippets embeds-snippets--locked" : "embeds-snippets"}>
                  <div className="embeds-snippets__inner" style={{ display: "grid", gap: "var(--space-3)" }}>
                    {activeVariants.map((variant) => (
                      <div key={variant.key} className="profile-embed-card__variant" style={{ display: "grid", gap: 6 }}>
                        <span className="label-mono profile-embed-card__variant-label">{variant.label}</span>
                        <SnippetCopyRow
                          buttonClassName={primaryButtonClassName}
                          cardLocked={cardLocked}
                          copied={copiedKey === variant.key}
                          inputClassName={copyInputClassName}
                          rowClassName={copyRowClassName}
                          snippet={variant.snippet}
                          onCopy={() => void copy(variant.key, variant.snippet)}
                        />
                      </div>
                    ))}
                  </div>
                  {cardLocked ? (
                    <div className="embeds-lock" role="note">
                      <span className="embeds-lock__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
                          <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
                        </svg>
                      </span>
                      <strong>Your public card is off</strong>
                      <p>Turn on your public focus card to activate these embeds. Only opt-in aggregates are shared.</p>
                      <button
                        type="button"
                        className={primaryButtonClassName}
                        style={{ borderRadius: 999 }}
                        disabled={card.busy || card.enabled === null}
                        onClick={() => void card.enable()}
                      >
                        {card.busy ? "Turning on…" : "Go public"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="embeds-rail" aria-label="Embed options">
                <div className="embeds-rail__group">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%" }}>
                    <span className="label-mono">Publicly shared data</span>
                    <span className={publishPillClass} style={{ marginLeft: "auto" }}>{publishPillText}</span>
                  </div>
                  <div className="embeds-scopes">
                    <label className="embeds-scope">
                      <input
                        className="drifty-checkbox"
                        type="checkbox"
                        role="switch"
                        aria-label="Public focus card"
                        checked={card.enabled === true}
                        disabled={card.busy || card.enabled === null}
                        onChange={(event) => void (event.target.checked ? card.enable() : card.disable())}
                      />
                      <span className="embeds-scope__copy">
                        <span className="embeds-scope__name">Weekly focus + daily series</span>
                        <span className="embeds-scope__desc">The base card. Aggregate weekly total and day-by-day focus.</span>
                      </span>
                    </label>
                    {(webAccountPreview ? SCOPE_DEFS : []).map((scope) => (
                      <label key={scope.key} className={`embeds-scope${cardLocked ? " embeds-scope--disabled" : ""}`}>
                        <input
                          className="drifty-checkbox"
                          type="checkbox"
                          role="switch"
                          aria-label={scope.label}
                          checked={card.detailFlags?.[scope.key] === true}
                          disabled={cardLocked || card.busy || card.detailFlags === null}
                          onChange={(event) => void card.setDetailFlag(scope.key, event.target.checked)}
                        />
                        <span className="embeds-scope__copy">
                          <span className="embeds-scope__name">{scope.label}</span>
                          <span className="embeds-scope__desc">
                            {scope.desc}
                            {scope.warning ? <em className="profile-detail-shares__warning"> {scope.warning}</em> : null}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {card.error ? <p className="profile-note profile-note--error">{card.error}</p> : null}
                </div>

                <div className="embeds-rail__group">
                  <span className="label-mono">Format</span>
                  <div className="embeds-format-list" role="radiogroup" aria-label="Embed format">
                    {FORMAT_META.map((format) => (
                      <button
                        key={format.key}
                        type="button"
                        role="radio"
                        aria-checked={activeFormat === format.key}
                        className={`embeds-format${activeFormat === format.key ? " embeds-format--active" : ""}`}
                        onClick={() => setActiveFormat(format.key)}
                      >
                        <span className="embeds-format__name">{format.label}</span>
                        <span className="embeds-format__desc">{format.desc}</span>
                        <span className={`embeds-format__lock${cardLocked ? "" : " embeds-format__lock--hidden"}`} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
                            <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {activeFormat === "badge" ? (
                  <div className="embeds-rail__group">
                    <span className="label-mono">Theme</span>
                    <div className="leaderboard-period-control seg" role="group" aria-label="Badge theme">
                      {(["light", "dark"] as const).map((theme) => (
                        <button
                          key={theme}
                          type="button"
                          className={embedTheme === theme ? "on" : ""}
                          aria-pressed={embedTheme === theme}
                          onClick={() => setEmbedTheme(theme)}
                        >
                          <span>{theme === "light" ? "Light" : "Dark"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activeFormat === "card" ? (
                  <div className="embeds-rail__group">
                    <span className="label-mono">Range</span>
                    <div className="leaderboard-period-control seg" role="group" aria-label="Card range">
                      {([7, 30] as const).map((range) => (
                        <button
                          key={range}
                          type="button"
                          className={cardRange === range ? "on" : ""}
                          aria-pressed={cardRange === range}
                          onClick={() => setCardRange(range)}
                        >
                          <span>{range} days</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function buildDataPreview(chartStats: ReturnType<typeof summarizeDailyProductivity>): string {
  const focus = chartStats ? chartStats.focusTotal : 0;
  const drift = chartStats ? chartStats.driftTotal : 0;
  const share = chartStats ? chartStats.sharePct / 100 : 0;
  return [
    "{",
    '  "range_days": 30,',
    '  "totals": {',
    `    "focus_seconds": ${focus},`,
    `    "drift_seconds": ${drift},`,
    `    "focus_share": ${share.toFixed(2)}`,
    "  },",
    '  "daily": [ /* aggregate focus & drift per day */ ]',
    "}",
  ].join("\n");
}
