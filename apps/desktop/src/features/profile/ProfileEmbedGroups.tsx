import type { ReactNode } from "react";
import { formatFocusDuration } from "../share/badgeSvg";
import type { BadgeThemeOption, CardRangeOption, EmbedSnippets } from "../share/embedSnippets";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { ProfileDraft } from "./ProfileModals";
import { FocusCardEmbedPreview, FocusDriftChart } from "./ProfileEmbedPreviews";

export type EmbedVariant = { readonly key: string; readonly label: string; readonly snippet: string };
export type EmbedGroup = {
  readonly key: string;
  readonly title: string;
  readonly preview: ReactNode;
  readonly controls?: ReactNode;
  readonly variants: readonly EmbedVariant[];
};

type ProductivitySummary = {
  readonly focusTotal: number;
  readonly driftTotal: number;
  readonly sharePct: number;
  readonly bestDayLabel: string;
} | null;

type EmbedGroupInput = {
  readonly badgeSrcFor: (theme: BadgeThemeOption) => string;
  readonly cardLocked: boolean;
  readonly cardRange: CardRangeOption;
  readonly chartStats: ProductivitySummary;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly displayName: string;
  readonly draft: ProfileDraft;
  readonly embedTheme: BadgeThemeOption;
  readonly focusSeconds7d: number;
  readonly setCardRange: (range: CardRangeOption) => void;
  readonly setEmbedTheme: (theme: BadgeThemeOption) => void;
  readonly snippets: EmbedSnippets;
};

export function buildEmbedGroups(input: EmbedGroupInput): readonly EmbedGroup[] {
  return [
    buildBadgeGroup(input),
    buildFocusCardGroup(input),
    buildChartGroup(input),
  ];
}

function buildBadgeGroup({
  badgeSrcFor,
  cardLocked,
  embedTheme,
  setEmbedTheme,
  snippets,
}: EmbedGroupInput): EmbedGroup {
  return {
    key: "badge",
    title: "Focus badge",
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
  };
}

function buildFocusCardGroup({
  cardLocked,
  cardRange,
  dailyProductivity,
  displayName,
  draft,
  embedTheme,
  focusSeconds7d,
  setCardRange,
  snippets,
}: EmbedGroupInput): EmbedGroup {
  return {
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
    variants: [{ key: "iframe", label: "Website · iframe", snippet: snippets.iframe }],
  };
}

function buildChartGroup({ chartStats, dailyProductivity, snippets }: EmbedGroupInput): EmbedGroup {
  return {
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
          <p className="capture-recency">Loading local history...</p>
        )}
      </div>
    ),
    variants: [{ key: "chart-iframe", label: "Website · iframe", snippet: snippets.chartIframe }],
  };
}

export function EmbedCard({
  cardLocked,
  copiedKey,
  copyInputClassName,
  copyRowClassName,
  group,
  primaryButtonClassName,
  onCopy,
}: {
  readonly cardLocked: boolean;
  readonly copiedKey: string | null;
  readonly copyInputClassName: string;
  readonly copyRowClassName: string;
  readonly group: EmbedGroup;
  readonly primaryButtonClassName: string;
  readonly onCopy: (key: string, text: string) => Promise<void>;
}) {
  return (
    <div className="profile-embed-card">
      <div className="profile-embed-card__head">
        <span className="label-mono">{group.title}</span>
        {group.controls ?? null}
      </div>
      <div className="profile-embed-card__preview">{group.preview}</div>
      {group.variants.map((variant) => (
        <div key={variant.key} className="profile-embed-card__variant">
          <span className="label-mono profile-embed-card__variant-label">{variant.label}</span>
          <SnippetCopyRow
            buttonClassName={primaryButtonClassName}
            cardLocked={cardLocked}
            copied={copiedKey === variant.key}
            inputClassName={copyInputClassName}
            rowClassName={copyRowClassName}
            snippet={variant.snippet}
            onCopy={() => void onCopy(variant.key, variant.snippet)}
          />
        </div>
      ))}
    </div>
  );
}

export function SnippetCopyRow({
  buttonClassName,
  cardLocked,
  copied,
  inputClassName,
  rowClassName,
  snippet,
  onCopy,
}: {
  readonly buttonClassName: string;
  readonly cardLocked: boolean;
  readonly copied: boolean;
  readonly inputClassName: string;
  readonly rowClassName: string;
  readonly snippet: string;
  readonly onCopy: () => void;
}) {
  return (
    <div className={rowClassName}>
      <input
        className={inputClassName}
        readOnly
        disabled={cardLocked}
        value={snippet}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="button"
        className={buttonClassName}
        disabled={cardLocked}
        title={cardLocked ? "Turn on your public focus card first" : undefined}
        onClick={onCopy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function summarizeDailyProductivity(dailyProductivity: readonly DailyProductivityPoint[] | null): ProductivitySummary {
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
}
