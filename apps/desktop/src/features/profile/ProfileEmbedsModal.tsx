// Focus embeds modal. Sharing consent lives on the Social → Profile surface; this dialog
// only changes presentation and copies the selected snippet. Left column = a single live
// preview stage + snippets; right rail = format and per-format options.
//
// Everything here is wired to real presentation capabilities only: theme (light/dark),
// card range (7/30), and the four working formats (badge/card/chart/data).
import { useMemo, useState } from "react";
import { formatFocusDuration, renderFocusBadgeSvg, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets } from "../share/embedSnippets";
import type { BadgeThemeOption, CardRangeOption } from "../share/embedSnippets";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import { buildPublicProfileUrl, copyTextToClipboard, type ProfileDraft } from "./ProfileModals";
import { buildEmbedGroups, SnippetCopyRow, summarizeDailyProductivity } from "./ProfileEmbedGroups";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";

export type ProfileEmbedFormat = "badge" | "card" | "chart" | "data";

const FORMAT_META: ReadonlyArray<{ readonly key: ProfileEmbedFormat; readonly label: string; readonly desc: string }> = [
  { key: "badge", label: "Badge", desc: "7-day total pill" },
  { key: "card", label: "Card", desc: "Rich focus card" },
  { key: "chart", label: "Chart", desc: "30-day bars" },
  { key: "data", label: "Data", desc: "Aggregate JSON" },
];

export type ProfileEmbedsModalProps = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly displayName: string;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly initialFormat?: ProfileEmbedFormat;
  readonly isProfilePublic: boolean;
  readonly publicId: string | null;
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
  initialFormat = "badge",
  isProfilePublic,
  publicId,
  onClose,
  onCopyProfileLink,
  onEditProfile,
}: ProfileEmbedsModalProps) {
  const [activeFormat, setActiveFormat] = useState<ProfileEmbedFormat>(initialFormat);
  const [embedTheme, setEmbedTheme] = useState<BadgeThemeOption>("light");
  const [cardRange, setCardRange] = useState<CardRangeOption>(7);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useModalDismiss(onClose);

  const cardLocked = card.enabled !== true || !isProfilePublic;
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
  const publishPillText = card.enabled === null ? "…" : card.enabled === true && isProfilePublic ? "Live" : card.enabled === true ? "Hidden" : "Private";
  const publishPillClass = `profile-state-pill${card.enabled === true && isProfilePublic ? " profile-state-pill--on" : card.enabled === null ? " profile-state-pill--pending" : ""}`;

  const copyInputClassName = "settings-input profile-field profile-field--code profile-embed-card__code";
  const copyRowClassName = "profile-copy-row profile-embed-card__variant-row";
  const primaryButtonClassName = "modal-btn modal-btn--primary";
  const copyButtonClassName = "modal-btn modal-btn--secondary";

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal profile-modal profile-embeds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="embeds-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close embeds" onClick={onClose} />
        <div className="profile-modal__header">
          <div>
            <h2 id="embeds-modal-title">Profile embed</h2>
            <p>Choose a format for the aggregate data shared from Profile.</p>
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
                  {isProfilePublic && publicProfileUrl ? (
                    <div className={copyRowClassName} style={{ flex: 1 }}>
                      <input
                        className={copyInputClassName}
                        readOnly
                        value={publicProfileUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button type="button" className={copyButtonClassName} aria-label="Copy profile link" onClick={onCopyProfileLink}>
                        Copy
                      </button>
                    </div>
                  ) : (
                    <span className="embeds-rail__hint">Off — turn on Public profile to restore this link.</span>
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
                          buttonClassName={copyButtonClassName}
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
                      <strong>{!isProfilePublic ? "Your public profile is off" : "Your focus summary is off"}</strong>
                      <p>{!isProfilePublic ? "Turn on Public profile in Profile to restore these embeds." : "Turn on Focus summary in Profile. Your choices stay saved."}</p>
                      <button
                        type="button"
                        className={primaryButtonClassName}
                        style={{ borderRadius: 999 }}
                        onClick={onClose}
                      >
                        Back to Profile
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="embeds-rail" aria-label="Embed options">
                <div className="embeds-rail__group">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%" }}>
                    <span className="label-mono">Focus sharing</span>
                    <span className={publishPillClass} style={{ marginLeft: "auto" }}>{publishPillText}</span>
                  </div>
                  <p className="embeds-rail__hint">Choose what is public from the Profile tab. Embed settings only change presentation.</p>
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
