import { useId, useState } from "react";
import { formatFocusDuration, renderFocusBadgeSvg, FOCUS_GREEN, AWAY_GREY } from "../share/badgeSvg";
import { buildEmbedSnippets, functionsBaseFromSupabaseUrl } from "../share/embedSnippets";
import type { BadgeThemeOption, CardRangeOption } from "../share/embedSnippets";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import type { FocusCardDetailFlags } from "../share/focusCardService";
import { buildPublicProfileUrl, copyTextToClipboard, type ProfileDraft } from "./ProfileModals";
import { buildEmbedGroups, EmbedCard, SnippetCopyRow, summarizeDailyProductivity } from "./ProfileEmbedGroups";
import type { EmbedGroup } from "./ProfileEmbedGroups";

type ProfileEmbedsSectionProps = {
  readonly redesign: boolean;
  readonly displayName: string;
  readonly draft: ProfileDraft;
  readonly publicId: string | null;
  readonly focusSeconds7d: number;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly card: FocusCardControls;
  readonly webAccountPreview?: boolean;
  readonly onCopyProfileLink: () => void;
  readonly onEditProfile: () => void;
};

export function ProfileEmbedsSection({
  redesign,
  displayName,
  draft,
  publicId,
  focusSeconds7d,
  dailyProductivity,
  card,
  webAccountPreview = false,
  onCopyProfileLink,
  onEditProfile,
}: ProfileEmbedsSectionProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [embedTheme, setEmbedTheme] = useState<BadgeThemeOption>("light");
  const [cardRange, setCardRange] = useState<CardRangeOption>(7);
  const [embedsOpen, setEmbedsOpen] = useState(false);
  const embedPanelId = useId();

  const cardLocked = card.enabled !== true;
  const chartStats = summarizeDailyProductivity(dailyProductivity);
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
  const functionsBase = supabaseUrl ? functionsBaseFromSupabaseUrl(supabaseUrl) : "";
  const snippets = publicId ? buildEmbedSnippets(publicId, functionsBase, { theme: embedTheme, range: cardRange }) : null;
  const publicProfileUrl = publicId ? buildPublicProfileUrl(publicId) : null;
  const primaryButtonClassName = "settings-btn settings-btn--primary profile-btn";
  const secondaryButtonClassName = "ghost-button profile-btn";
  const copyInputClassName = "settings-input profile-field profile-field--code profile-embed-card__code";
  const copyRowClassName = "profile-copy-row profile-embed-card__variant-row";
  const embedsToggleLabel = embedsOpen ? "Collapse embeds" : "Expand embeds";
  const profileCardStateClassName = `profile-state-pill${
    card.enabled === true ? " profile-state-pill--on" : card.enabled === null ? " profile-state-pill--pending" : ""
  }`;
  const badgeSrcFor = (theme: BadgeThemeOption) => {
    const svg = renderFocusBadgeSvg({
      value: focusSeconds7d > 0 ? formatFocusDuration(focusSeconds7d) : "—",
      theme,
      accent: card.enabled === true && focusSeconds7d > 0 ? FOCUS_GREEN : AWAY_GREY,
    });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };
  const copy = async (key: string, text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    } catch (error) {
      setCopiedKey(null);
      if (!(error instanceof Error)) throw error;
    }
  };
  const embedGroups: readonly EmbedGroup[] = snippets
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
    : [];

  return (
    <section className={`leaderboard-profile-block profile-embeds${redesign ? " profile-card" : ""}`} aria-label="Embeds">
      <button
        type="button"
        className="leaderboard-section-kicker profile-embeds__summary"
        aria-label={embedsToggleLabel}
        aria-controls={embedPanelId}
        aria-expanded={embedsOpen}
        onClick={() => setEmbedsOpen((open) => !open)}
      >
        <div>
          <span className="label-mono">Embeds</span>
          <p>
            Badge, card, chart, JSON. Auto-updating.
          </p>
        </div>
        <span className="profile-embeds__head-actions">
          {cardLocked ? <span className="profile-state-pill">Publish to activate</span> : null}
          <span className="profile-embeds__chevron" aria-hidden="true">&gt;</span>
        </span>
      </button>
      <div id={embedPanelId} className="profile-embeds__body" hidden={!embedsOpen}>
        {!embedsOpen ? null : snippets ? (
          <div className={cardLocked ? "profile-embed-stack profile-embed-stack--locked" : "profile-embed-stack"}>
            <div className="profile-embed-card profile-embed-card--publish" aria-label="Public focus card">
              <div className="profile-share__publish">
                <div className="profile-share__publish-copy">
                  <div className="profile-share__publish-head">
                    <span className={`profile-status-dot${card.enabled === true ? " profile-status-dot--on" : ""}`} aria-hidden="true" />
                    <span className="profile-share__title">Public focus card</span>
                    <span className={profileCardStateClassName}>{card.enabled === true ? "Live" : card.enabled === null ? "..." : "Off"}</span>
                  </div>
                  <p>
                    {card.enabled === true
                      ? "Anyone with your link sees weekly focus, drift/neutral split, and daily focus."
                      : card.enabled === null
                        ? "Checking..."
                        : "Your card, badges, and embeds stay blank until you publish."}
                  </p>
                  {card.error ? <p className="profile-note profile-note--error">{card.error}</p> : null}
                </div>
                {card.enabled === true ? (
                  <button type="button" className={secondaryButtonClassName} disabled={card.busy} onClick={() => void card.disable()}>
                    {card.busy ? "Saving..." : "Make private"}
                  </button>
                ) : (
                  <button type="button" className={primaryButtonClassName} disabled={card.busy || card.enabled === null} onClick={() => void card.enable()}>
                    {card.busy ? "Turning on..." : "Make public"}
                  </button>
                )}
              </div>
              {card.enabled === true && publicProfileUrl ? (
                <div className="profile-share__row" aria-label="Public profile link">
                  <span className="label-mono profile-share__rail">Public page</span>
                  <div className={copyRowClassName}>
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
                </div>
              ) : null}
              {webAccountPreview ? <ProfileDetailShares card={card} /> : null}
            </div>
            {embedGroups.map((group) => (
              <EmbedCard
                key={group.key}
                cardLocked={cardLocked}
                copiedKey={copiedKey}
                copyInputClassName={copyInputClassName}
                copyRowClassName={copyRowClassName}
                group={group}
                primaryButtonClassName={primaryButtonClassName}
                onCopy={copy}
              />
            ))}
            <div className="profile-embed-card profile-embed-card--link">
              <div className="profile-embed-card__variant">
                <span className="label-mono profile-embed-card__variant-label">Data · JSON · 30-day</span>
                <SnippetCopyRow
                  buttonClassName={primaryButtonClassName}
                  cardLocked={cardLocked}
                  copied={copiedKey === "data"}
                  inputClassName={copyInputClassName}
                  rowClassName={copyRowClassName}
                  snippet={snippets.dataUrl}
                  onCopy={() => void copy("data", snippets.dataUrl)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="profile-embeds__setup">
            <p className="profile-note">Save your profile once to mint your public link, then your embeds appear here.</p>
            <button type="button" className={primaryButtonClassName} onClick={onEditProfile}>Set up profile</button>
          </div>
        )}
      </div>
    </section>
  );
}

const detailToggleDefs: ReadonlyArray<{
  readonly key: keyof FocusCardDetailFlags;
  readonly label: string;
  readonly description: string;
  readonly warning: string | null;
}> = [
  {
    key: "shareCategoryBreakdown",
    label: "Category breakdown",
    description: "Adds 7-day totals per category (workspace, learning, ...). Categories only — no app names, titles, or URLs.",
    warning: null,
  },
  {
    key: "shareHourlyPattern",
    label: "Hourly focus rhythm",
    description: "Adds your average focus per hour of day over the last 7 days — 24 averages, not a timeline of your sessions.",
    warning: null,
  },
  {
    key: "shareTopApps",
    label: "Top apps",
    description: "Adds your top 5 apps by time this week (15 min or more each).",
    warning: "This makes those app names public to anyone with your link.",
  },
];

function ProfileDetailShares({ card }: { readonly card: FocusCardControls }) {
  return (
    <div className="profile-detail-shares" aria-label="Optional card details">
      <span className="label-mono">Card details</span>
      <p className="capture-recency profile-detail-shares__intro">
        Optional extras for your public card — each is off by default and shown only while your card is public.
      </p>
      {detailToggleDefs.map((def) => (
        <label key={def.key} className="profile-detail-shares__row">
          <input
            className="drifty-checkbox"
            type="checkbox"
            role="switch"
            aria-label={def.label}
            checked={card.detailFlags?.[def.key] === true}
            disabled={card.busy || card.detailFlags === null}
            onChange={(event) => void card.setDetailFlag(def.key, event.target.checked)}
          />
          <span className="profile-detail-shares__copy">
            <strong>{def.label}</strong>
            <small>
              {def.description}
              {def.warning ? <em className="profile-detail-shares__warning"> {def.warning}</em> : null}
            </small>
          </span>
        </label>
      ))}
    </div>
  );
}
