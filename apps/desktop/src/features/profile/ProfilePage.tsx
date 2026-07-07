// Profile tab — the home for everything the outside world can see about you:
// public profile fields, the opt-in public focus card, and the copy-paste embeds.
// Deliberately separate from the Leaderboard tab (which is just the ranking board);
// a user can publish a focus card without ever joining the leaderboard.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "../leaderboard/leaderboardViewHelpers";
import { copyTextToClipboard } from "./ProfileModals";
import type { ProfileDraft } from "./ProfileModals";
import { renderFocusBadgeSvg, formatFocusDuration, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets, functionsBaseFromSupabaseUrl } from "../share/embedSnippets";
import type { BadgeThemeOption, CardRangeOption } from "../share/embedSnippets";
import type { FocusCardControls } from "../share/useFocusCard";
import type { DailyProductivityPoint } from "../share/dailyProductivity";

export type ProfilePageProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  displayName: string;
  avatarUrl: string;
  /** Editable profile fields, shown inline (same draft the editor modal uses). */
  draft: ProfileDraft;
  onDraftChange: (updater: Partial<ProfileDraft>) => void;
  onSaveProfile: () => void;
  isSavingProfile: boolean;
  publicId: string | null;
  /** Local rolling 7-day focus, for the badge preview (works without any cloud state). */
  focusSeconds7d: number;
  /** Local 30-day focus/drift series for the chart; null while loading. */
  dailyProductivity: readonly DailyProductivityPoint[] | null;
  card: FocusCardControls;
  isLeaderboardOptedIn: boolean;
  leaderboardRank: number | null;
  shareMessage: string | null;
  profileMessage: string | null;
  profileError: string | null;
  onEditProfile: () => void;
  onCopyProfileLink: () => void;
  onOpenLeaderboard: () => void;
  onSignIn: () => void;
};

export function ProfilePage({
  isSupabaseEnabled,
  isSignedIn,
  displayName,
  avatarUrl,
  draft,
  onDraftChange,
  onSaveProfile,
  isSavingProfile,
  publicId,
  focusSeconds7d,
  dailyProductivity,
  card,
  isLeaderboardOptedIn,
  leaderboardRank,
  shareMessage,
  profileMessage,
  profileError,
  onEditProfile,
  onCopyProfileLink,
  onOpenLeaderboard,
  onSignIn,
}: ProfilePageProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // One options state drives previews AND snippets in the same tick (YouTube/Cal.com pattern).
  const [embedTheme, setEmbedTheme] = useState<BadgeThemeOption>("light");
  const [cardRange, setCardRange] = useState<CardRangeOption>(7);
  const [embedsOpen, setEmbedsOpen] = useState(false);

  const { refresh: refreshCard } = card;
  useEffect(() => {
    if (isSignedIn) void refreshCard();
  }, [isSignedIn, refreshCard]);

  const cardLocked = card.enabled !== true;
  const chartStats = (() => {
    if (!dailyProductivity || dailyProductivity.length === 0) return null;
    let focusTotal = 0;
    let driftTotal = 0;
    let best: DailyProductivityPoint = dailyProductivity[0];
    for (const point of dailyProductivity) {
      focusTotal += point.focus;
      driftTotal += point.drift;
      if (point.focus > best.focus) best = point;
    }
    const classified = focusTotal + driftTotal;
    return {
      focusTotal,
      driftTotal,
      sharePct: classified > 0 ? Math.round((focusTotal / classified) * 100) : 0,
      bestDayLabel: best.focus > 0 ? `${best.day.slice(5)} · ${formatFocusDuration(best.focus)}` : "—",
    };
  })();
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const functionsBase = supabaseUrl ? functionsBaseFromSupabaseUrl(supabaseUrl) : "";
  const snippets = publicId ? buildEmbedSnippets(publicId, functionsBase, { theme: embedTheme, range: cardRange }) : null;

  const isLive = card.enabled === true && focusSeconds7d > 0;
  const badgeSrcFor = (theme: BadgeThemeOption) => {
    const svg = renderFocusBadgeSvg({
      value: focusSeconds7d > 0 ? formatFocusDuration(focusSeconds7d) : "—",
      theme,
      accent: isLive ? FOCUS_GREEN : AWAY_GREY,
    });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const copy = async (key: string, text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    } catch {
      setCopiedKey(null);
    }
  };

  // Embeds are grouped by what they LOOK like (badge vs card), with the paste formats
  // listed under each visual — the badge is one artifact whether it lands in a README
  // or a website, so it gets one preview and two code variants.
  type EmbedVariant = { key: string; label: string; snippet: string };
  type EmbedGroup = { key: string; title: string; preview: ReactNode; controls?: ReactNode; variants: EmbedVariant[] };
  const embedGroups: EmbedGroup[] = snippets
    ? [
        {
          key: "badge",
          title: "Focus badge",
          // Theme picker = the preview itself: both themes rendered live with your own
          // data (github-readme-stats gallery pattern); picking one rewrites the snippets.
          preview: (
            <div className="profile-theme-picker" role="radiogroup" aria-label="Badge theme">
              {(["light", "dark"] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={embedTheme === theme}
                  className={`profile-theme-picker__option${embedTheme === theme ? " profile-theme-picker__option--active" : ""} profile-theme-picker__option--${theme}`}
                  disabled={cardLocked}
                  onClick={() => setEmbedTheme(theme)}
                >
                  <img src={badgeSrcFor(theme)} alt={`Focus badge preview (${theme})`} height={20} style={{ display: "block" }} />
                  <span className="profile-theme-picker__label">{theme}</span>
                </button>
              ))}
            </div>
          ),
          variants: [
            { key: "markdown", label: "GitHub README · Markdown", snippet: snippets.markdown },
            { key: "html", label: "Website · HTML", snippet: snippets.html },
          ],
        },
        {
          key: "card",
          title: "Focus card",
          controls: (
            <div className="profile-range-picker" role="radiogroup" aria-label="Card chart range">
              {([7, 30] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  role="radio"
                  aria-checked={cardRange === range}
                  className={`profile-range-picker__option${cardRange === range ? " profile-range-picker__option--active" : ""}`}
                  disabled={cardLocked}
                  onClick={() => setCardRange(range)}
                >
                  {range}d
                </button>
              ))}
            </div>
          ),
          preview: (
            <FocusCardEmbedPreview
              displayName={draft.displayName || displayName}
              focusSeconds={focusSeconds7d}
              theme={embedTheme}
              dailyFocus={dailyProductivity?.slice(-cardRange).map((point) => point.focus) ?? null}
            />
          ),
          variants: [
            { key: "iframe", label: "Website · iframe", snippet: snippets.iframe },
          ],
        },
        {
          key: "chart",
          title: "Focus chart · last 30 days",
          preview: (
            <div className="profile-chart-embed-preview">
              {chartStats ? (
                <div className="profile-chart__stats">
                  <span><i className="profile-chart__dot profile-chart__dot--focus" />focus <strong>{formatFocusDuration(chartStats.focusTotal)}</strong></span>
                  <span><i className="profile-chart__dot profile-chart__dot--drift" />drift <strong>{formatFocusDuration(chartStats.driftTotal)}</strong></span>
                  <span>share <strong>{chartStats.sharePct}%</strong></span>
                  <span>best <strong>{chartStats.bestDayLabel}</strong></span>
                </div>
              ) : null}
              {dailyProductivity && dailyProductivity.length > 0 ? (
                <FocusDriftChart series={dailyProductivity} />
              ) : (
                <p className="capture-recency">Loading local history…</p>
              )}
            </div>
          ),
          variants: [
            { key: "chart-iframe", label: "Website · iframe", snippet: snippets.chartIframe },
          ],
        },
      ]
    : [];

  return (
    <div className="page profile-page">
      <div className="pg-head">
        <div>
          <h1>Your public profile</h1>
          <p className="capture-recency profile-page__privacy">
            Only opt-in aggregates are shared (daily focus/drift totals, weekly split) — raw app, site, window, and session history stays on your device.
          </p>
        </div>
      </div>

      {!isSupabaseEnabled ? (
        <section className="leaderboard-profile-block" aria-label="Profile unavailable">
          <span className="label-mono">Sync required</span>
          <p className="capture-recency">Supabase is not configured for this workspace, so public profile features are unavailable.</p>
        </section>
      ) : !isSignedIn ? (
        <section className="leaderboard-profile-block" aria-label="Sign in to build your profile">
          <span className="label-mono">Public profile</span>
          <p className="capture-recency">Sign in to create your public profile, focus card, and embeds. Nothing is published until you turn it on.</p>
          <div className="leaderboard-hero__actions">
            <button type="button" className="settings-btn" onClick={onSignIn}>Sign in</button>
          </div>
        </section>
      ) : (
        <div className="leaderboard-panel__stack">
          {/* Identity + leaderboard status */}
          <section className="leaderboard-profile-block" aria-label="Your public identity">
            <div className="profile-identity__main">
              <ProfileAvatar className="leaderboard-hero__avatar" name={draft.displayName || displayName} src={avatarUrl || null} />
              <div className="profile-identity__form">
                <div className="profile-identity__name-row">
                  <input
                    className="settings-input profile-identity__name-input"
                    aria-label="Display name"
                    placeholder="Display name"
                    value={draft.displayName}
                    onChange={(event) => onDraftChange({ displayName: event.target.value })}
                  />
                  <button type="button" className="ghost-button" onClick={onEditProfile}>Change photo</button>
                  <button type="button" className="settings-btn" disabled={isSavingProfile} onClick={onSaveProfile}>
                    {isSavingProfile ? "Saving…" : "Save"}
                  </button>
                </div>
                <textarea
                  className="settings-input profile-identity__bio-input"
                  aria-label="Bio"
                  placeholder="Short bio — shows on your public card."
                  rows={2}
                  value={draft.bio}
                  onChange={(event) => onDraftChange({ bio: event.target.value })}
                />
                <div className="profile-identity__links">
                  <input
                    className="settings-input"
                    aria-label="Website"
                    placeholder="Website (https://…)"
                    value={draft.websiteUrl}
                    onChange={(event) => onDraftChange({ websiteUrl: event.target.value })}
                  />
                  <input
                    className="settings-input"
                    aria-label="GitHub"
                    placeholder="GitHub"
                    value={draft.githubUrl}
                    onChange={(event) => onDraftChange({ githubUrl: event.target.value })}
                  />
                  <input
                    className="settings-input"
                    aria-label="LinkedIn"
                    placeholder="LinkedIn"
                    value={draft.linkedinUrl}
                    onChange={(event) => onDraftChange({ linkedinUrl: event.target.value })}
                  />
                </div>
                {profileError ? <p className="capture-recency capture-recency--error" style={{ margin: 0 }}>{profileError}</p> : null}
                {profileMessage ? <p className="capture-recency" style={{ margin: 0 }}>{profileMessage}</p> : null}
              </div>
            </div>
            <div className="profile-identity__control profile-card-control__row" aria-label="Public focus card">
              <span className="label-mono">Public focus card</span>
              <span className={`profile-card-control__state${card.enabled === true ? " profile-card-control__state--on" : ""}`}>
                {card.enabled === true ? "On" : card.enabled === null ? "…" : "Off"}
              </span>
              <div className="profile-card-control__copy">
                <p className="capture-recency">
                  {card.enabled === true
                    ? "Anyone with your link sees weekly focus, drift/neutral split, and daily focus. Turning it off pauses these links — they resume when you turn it back on."
                    : card.enabled === null
                      ? "Checking…"
                      : "One switch controls your card, badges, and embeds — off means they show nothing."}
                </p>
                {card.error ? <p className="capture-recency capture-recency--error" style={{ margin: "4px 0 0" }}>{card.error}</p> : null}
              </div>
              {card.enabled === true ? (
                <button type="button" className="ghost-button" disabled={card.busy} onClick={() => void card.disable()}>
                  {card.busy ? "Saving…" : "Make private"}
                </button>
              ) : (
                <button type="button" className="settings-btn" disabled={card.busy || card.enabled === null} onClick={() => void card.enable()}>
                  {card.busy ? "Turning on…" : "Make public"}
                </button>
              )}
            </div>
            {card.enabled === true && snippets ? (
              <div className="profile-identity__link" aria-label="Public profile link">
                <span className="label-mono">Public page</span>
                <div className="profile-embed-card__variant-row">
                  <input
                    className="settings-input profile-embed-card__code"
                    readOnly
                    value={snippets.profileUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" className="settings-btn" aria-label="Copy profile link" onClick={onCopyProfileLink}>
                    Copy
                  </button>
                </div>
              </div>
            ) : null}
            <div className="profile-identity__board" aria-label="Leaderboard participation">
              <span className="label-mono">Leaderboard</span>
              <span className="profile-identity__board-status">
                {isLeaderboardOptedIn
                  ? leaderboardRank !== null
                    ? `On the board · #${leaderboardRank}`
                    : "On the board"
                  : "Not on the board — joining is separate from your focus card."}
              </span>
              <button type="button" className="ghost-button" onClick={onOpenLeaderboard}>Open leaderboard</button>
            </div>
          </section>

          {/* Embeds — collapsed by default */}
          <section className="leaderboard-profile-block" aria-label="Embeds">
            <div className="leaderboard-section-kicker">
              <div>
                <span className="label-mono">Embeds</span>
                <p>
                  Badge, card, 30-day chart, and raw JSON for your site, GitHub README, or blog. They update themselves.
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                aria-expanded={embedsOpen}
                onClick={() => setEmbedsOpen((open) => !open)}
              >
                {embedsOpen ? "Hide" : "Show"}
              </button>
            </div>
            {!embedsOpen ? null : snippets ? (
              <>
                <div className={cardLocked ? "profile-embed-stack profile-embed-stack--locked" : "profile-embed-stack"}>
                  {embedGroups.map((group) => (
                    <div key={group.key} className="profile-embed-card">
                      <div className="profile-embed-card__head">
                        <span className="label-mono">{group.title}</span>
                        {group.controls ?? null}
                      </div>
                      <div className="profile-embed-card__preview">{group.preview}</div>
                      {group.variants.map((variant) => (
                        <div key={variant.key} className="profile-embed-card__variant">
                          <span className="label-mono profile-embed-card__variant-label">{variant.label}</span>
                          <div className="profile-embed-card__variant-row">
                            <input
                              className="settings-input profile-embed-card__code"
                              readOnly
                              disabled={cardLocked}
                              value={variant.snippet}
                              onFocus={(event) => event.currentTarget.select()}
                            />
                            <button
                              type="button"
                              className="settings-btn"
                              disabled={cardLocked}
                              title={cardLocked ? "Turn on your public focus card first" : undefined}
                              onClick={() => void copy(variant.key, variant.snippet)}
                            >
                              {copiedKey === variant.key ? "Copied" : "Copy"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="profile-embed-card profile-embed-card--link">
                    <span className="label-mono">Data · JSON (30-day daily focus)</span>
                    <div className="profile-embed-card__variant-row">
                      <input
                        className="settings-input profile-embed-card__code"
                        readOnly
                        disabled={cardLocked}
                        value={snippets.dataUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="settings-btn"
                        disabled={cardLocked}
                        title={cardLocked ? "Turn on your public focus card first" : undefined}
                        onClick={() => void copy("data", snippets.dataUrl)}
                      >
                        {copiedKey === "data" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <p className="capture-recency">Save your profile once to mint your public link, then your embeds appear here.</p>
                <button type="button" className="settings-btn" onClick={onEditProfile}>Set up profile</button>
              </div>
            )}
          </section>

        </div>
      )}

      {shareMessage ? <div className="leaderboard-share-toast" role="status">{shareMessage}</div> : null}
    </div>
  );
}

// Stacked per-day bars: focus (green) with drift (red) on top. Pure SVG, local data only.
function FocusDriftChart({ series }: { series: readonly DailyProductivityPoint[] }) {
  const H = 96;
  const n = series.length;
  const max = Math.max(...series.map((point) => point.focus + point.drift), 1);
  const gap = n > 14 ? 2.4 : 5;
  const barW = (1000 - gap * (n - 1)) / n;

  return (
    <div className="profile-chart" role="img" aria-label={`Daily focus and drift, last ${n} days`}>
      <svg viewBox={`0 0 1000 ${H + 2}`} preserveAspectRatio="none" className="profile-chart__svg">
        {series.map((point, index) => {
          const x = index * (barW + gap);
          const focusH = (point.focus / max) * H;
          const driftH = (point.drift / max) * H;
          const isEmpty = point.focus + point.drift === 0;
          return (
            <g key={point.day}>
              <title>{`${point.day} · focus ${formatFocusDuration(point.focus)} · drift ${formatFocusDuration(point.drift)}`}</title>
              {isEmpty ? (
                <rect x={x} y={H - 2} width={barW} height={2} rx={1} fill="#d6d8cd" />
              ) : (
                <>
                  <rect x={x} y={H - focusH} width={barW} height={Math.max(focusH, point.focus > 0 ? 2 : 0)} rx={1.5} fill="#2e9e4f" />
                  <rect x={x} y={H - focusH - driftH} width={barW} height={Math.max(driftH, point.drift > 0 ? 2 : 0)} rx={1.5} fill="#dc5a4e" opacity={0.9} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="profile-chart__axis">
        <span>{series[0]?.day.slice(5)}</span>
        <span>{series[Math.floor(n / 2)]?.day.slice(5)}</span>
        <span>{series[n - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

// Local mock of the hosted drifty.so/embed card so users can see what the iframe embed
// will look like before pasting it anywhere. Purely presentational; mirrors the embed
// page's layout (avatar · name · weekly focus · daily bars · powered-by footer) and
// re-renders live as the theme/range options change.
function FocusCardEmbedPreview({
  displayName,
  focusSeconds,
  theme = "light",
  dailyFocus = null,
}: {
  displayName: string;
  focusSeconds: number;
  theme?: BadgeThemeOption;
  dailyFocus?: readonly number[] | null;
}) {
  const name = displayName.trim() || "drifty";
  const isLive = focusSeconds > 0;
  const dark = theme === "dark";
  const palette = dark
    ? { surface: "#181c16", surfaceStrong: "#232821", line: "#2c3128", ink: "#f3f5f0", muted: "#a7aca2", green: "#57c47a", stub: "#3a4036" }
    : { surface: "#ffffff", surfaceStrong: "#f2f2ee", line: "#e2e2dc", ink: "#17201a", muted: "#6b6f66", green: "#1c7e3c", stub: "#d6d8cd" };
  const bars = dailyFocus && dailyFocus.length > 0 ? dailyFocus : null;
  const barMax = bars ? Math.max(...bars, 1) : 1;

  return (
    <div aria-label="Website card preview" style={{ width: 320, maxWidth: "100%", border: `1px solid ${palette.line}`, borderRadius: 14, padding: "13px 15px", background: palette.surface, color: palette.ink, display: "flex", flexDirection: "column", gap: 9, boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: palette.surfaceStrong, border: `1px solid ${palette.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: palette.green }}>
        {(name.charAt(0) || "D").toUpperCase()}
        </span>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="label-mono" style={{ color: palette.muted }}>Focus · this week</span>
        <span style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.02em", color: palette.green, lineHeight: 1 }}>
          {isLive ? formatFocusDuration(focusSeconds) : "—"}
        </span>
      </div>
      {bars ? (
        <svg viewBox={`0 0 100 16`} preserveAspectRatio="none" style={{ width: "100%", height: 26, display: "block" }} aria-hidden="true">
          {bars.map((value, index) => {
            const n = bars.length;
            const gap = n > 14 ? 0.6 : 1.6;
            const barW = (100 - gap * (n - 1)) / n;
            const h = value > 0 ? Math.max(1.5, (value / barMax) * 14) : 0.8;
            return <rect key={index} x={index * (barW + gap)} y={16 - h} width={barW} height={h} rx={0.6} fill={value > 0 ? (index === n - 1 ? palette.green : "#2e9e4f") : palette.stub} />;
          })}
        </svg>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${palette.line}`, paddingTop: 8, fontSize: "0.72rem", color: palette.muted }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? "#2e9e4f" : "#9a9e96" }} />
        <span>live preview</span>
        <span style={{ marginLeft: "auto", fontWeight: 600 }}>powered by <strong style={{ color: palette.ink }}>drifty</strong> ↗</span>
      </div>
    </div>
  );
}
