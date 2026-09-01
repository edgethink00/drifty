import { useEffect, useMemo, useState } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";
import {
  SHARE_CARD_EXPORT_SIZES,
  renderShareCardSvg,
  renderShareWeekCardSvg,
  type ShareCardTheme,
} from "./shareCardSvg";
import {
  SHARE_CARD_UNIFIED_SIZE,
  UNIFIED_STORY_OPTIONS,
  renderLockedShareRankSvg,
  type ShareCardLiveRanks,
  type UnifiedShareStoryId,
} from "./shareCardUnifiedSvg";
import { copyShareCardPng, openShareComposer, saveShareCardWithDialog, shareCardSvgDataUrl } from "./shareCardExport";
import { buildShareCardCaption, buildShareComposerUrl, type ShareCardDestination } from "./shareCardSocial";
import { useShareCardLiveRanks, type ShareCardLiveRanksState } from "./useShareCardLiveRanks";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";

export type ShareCardModalCard =
  | { readonly kind: "day"; readonly data: ShareCardData }
  | { readonly kind: "week"; readonly data: ShareWeekCardData };

type ShareCardModalProps = {
  readonly card: ShareCardModalCard;
  readonly defaultTheme: ShareCardTheme;
  /** Opens the existing aggregate-only leaderboard opt-in flow. */
  readonly onJoinLeaderboard?: () => Promise<void>;
  readonly onClose: () => void;
};

const STORY_OPTIONS = UNIFIED_STORY_OPTIONS;
const SHARE_CARD_FORMAT = "landscape" as const;

const DAY_STORIES = new Set<UnifiedShareStoryId>(["R1c", "R2", "R4", "F1", "C1", "X4", "X5"]);
const WEEK_STORIES = new Set<UnifiedShareStoryId>(["WR1", "W5", "X4", "X5"]);
// A modeled Top n% is available from local aggregates. Only Place Rank claims
// an exact live position and therefore needs leaderboard opt-in.
const EXACT_RANK_STORY_PERIOD: Partial<Record<UnifiedShareStoryId, "daily" | "weekly">> = {
  R4: "daily",
};
const LIVE_RANK_STORY_PERIOD: Partial<Record<UnifiedShareStoryId, "daily" | "weekly">> = {
  R1c: "daily",
  R2: "daily",
  C1: "daily",
  R4: "daily",
  WR1: "weekly",
};

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly action: "copy" | "save" | ShareCardDestination }
  | { readonly kind: "copied" }
  | { readonly kind: "saved" }
  | { readonly kind: "shared"; readonly destination: ShareCardDestination }
  | { readonly kind: "error"; readonly message: string };

type RankGate = {
  readonly detail: string;
  readonly action: "join" | null;
};

function rankMatchesCard(
  card: ShareCardModalCard,
  rank: ShareCardLiveRanksState["daily"],
): boolean {
  if (rank.availability !== "ready" || !rank.rank) return false;
  if (card.kind === "day") {
    return rank.rank.windowStartDay === card.data.day && rank.rank.windowEndDay === card.data.day;
  }
  return rank.rank.windowStartDay === card.data.startDay && rank.rank.windowEndDay === card.data.endDay;
}

function storyOptionsForCard(card: ShareCardModalCard) {
  return STORY_OPTIONS.filter((option) => (
    card.kind === "day" ? DAY_STORIES.has(option.value) : WEEK_STORIES.has(option.value)
  ));
}

function rankGateForStory(
  card: ShareCardModalCard,
  story: UnifiedShareStoryId,
  liveRanks: ShareCardLiveRanksState,
  t: LocalizationController["t"],
): RankGate | null {
  const period = EXACT_RANK_STORY_PERIOD[story];
  if (!period) return null;
  const state = liveRanks[period];
  if (rankMatchesCard(card, state)) return null;
  if (state.availability === "loading") {
    return { detail: t("share.checkingRank"), action: null };
  }
  if (state.availability === "not_joined") {
    return { detail: t("share.joinToUnlock"), action: "join" };
  }
  if (state.availability === "ready") {
    return { detail: t("share.rankCurrentWindow"), action: null };
  }
  return { detail: t("share.rankUnavailable"), action: null };
}

export function ShareCardModal({ card, defaultTheme, onJoinLeaderboard, onClose }: ShareCardModalProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [selectedStoryId, setSelectedStoryId] = useState<UnifiedShareStoryId | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [joiningLeaderboard, setJoiningLeaderboard] = useState(false);
  const storyOptions = useMemo(() => storyOptionsForCard(card), [card]);
  const storyOption = storyOptions.find((option) => option.value === selectedStoryId) ?? storyOptions[0] ?? STORY_OPTIONS[0];
  const storyIndex = Math.max(0, storyOptions.findIndex((option) => option.value === storyOption.value));
  const rankStoryPeriod = EXACT_RANK_STORY_PERIOD[storyOption.value];
  const liveRankStoryPeriod = LIVE_RANK_STORY_PERIOD[storyOption.value];
  // Rank stories prefer an opted-in aggregate leaderboard fact for the exact
  // matching window. The local elapsed-time model remains the fallback.
  const { state: liveRankState, refresh: refreshLiveRanks } = useShareCardLiveRanks(Boolean(onJoinLeaderboard && liveRankStoryPeriod));
  const rankGate = rankGateForStory(card, storyOption.value, liveRankState, t);
  const lockedRankPeriod = rankGate && rankStoryPeriod ? rankStoryPeriod : null;
  const matchingLiveRanks = useMemo<ShareCardLiveRanks>(() => ({
    daily: card.kind === "day" && rankMatchesCard(card, liveRankState.daily) ? liveRankState.daily.rank : null,
    weekly: card.kind === "week" && rankMatchesCard(card, liveRankState.weekly) ? liveRankState.weekly.rank : null,
  }), [card, liveRankState.daily, liveRankState.weekly]);

  useModalDismiss(onClose);

  const svg = useMemo(() => {
    if (lockedRankPeriod) {
      return renderLockedShareRankSvg({
        theme: defaultTheme,
        period: lockedRankPeriod,
        lookIndex: storyIndex,
        language: "en",
      });
    }
    return card.kind === "week"
      ? renderShareWeekCardSvg({ data: card.data, format: SHARE_CARD_FORMAT, theme: defaultTheme, story: storyOption.value, lookIndex: storyIndex, liveRanks: matchingLiveRanks })
      : renderShareCardSvg({ data: card.data, format: SHARE_CARD_FORMAT, theme: defaultTheme, story: storyOption.value, lookIndex: storyIndex, liveRanks: matchingLiveRanks });
  }, [card, defaultTheme, matchingLiveRanks, lockedRankPeriod, storyIndex, storyOption.value]);
  const previewAlt = card.kind === "week"
    ? t("share.previewWeekAria", { week: card.data.weekLabel, range: card.data.rangeLabel })
    : t("share.previewDayAria", { day: `${card.data.weekdayLabel} ${card.data.dateLabel}` });
  const storyLabel = (index: number, fallback: string) => effectiveLanguage === "ko" ? t("share.storyLabel", { index: index + 1 }) : fallback;
  const fileName = card.kind === "week"
    ? `drifty-week-${card.data.startDay}`
    : `drifty-${card.data.day}`;
  const previewSrc = useMemo(() => shareCardSvgDataUrl(svg), [svg]);
  const exportSize = SHARE_CARD_EXPORT_SIZES[SHARE_CARD_FORMAT] ?? SHARE_CARD_UNIFIED_SIZE;
  const working = exportState.kind === "working";
  const actionsDisabled = working || lockedRankPeriod !== null;
  const caption = buildShareCardCaption();

  useEffect(() => {
    if (exportState.kind === "idle" || exportState.kind === "working") return;
    const timeout = window.setTimeout(() => setExportState({ kind: "idle" }), 3_400);
    return () => window.clearTimeout(timeout);
  }, [exportState]);

  const selectStory = (nextIndex: number) => {
    if (working || storyOptions.length === 0) return;
    const normalizedIndex = (nextIndex + storyOptions.length) % storyOptions.length;
    setSelectedStoryId(storyOptions[normalizedIndex]?.value ?? storyOption.value);
    setExportState({ kind: "idle" });
  };

  const handleJoinLeaderboard = () => {
    if (!onJoinLeaderboard || joiningLeaderboard) return;
    setJoiningLeaderboard(true);
    onJoinLeaderboard()
      .then(() => refreshLiveRanks())
      .catch((error: unknown) => settle({
        kind: "error",
        message: error instanceof Error ? error.message : t("share.joinError"),
      }))
      .finally(() => setJoiningLeaderboard(false));
  };

  const settle = (state: ExportState) => {
    setExportState(state);
  };

  const handleCopy = () => {
    if (actionsDisabled) return;
    setExportState({ kind: "working", action: "copy" });
    // Keep the ClipboardItem creation synchronous within the click gesture —
    // WebKit rejects clipboard writes that start after an intervening await.
    copyShareCardPng(svg, exportSize.width, exportSize.height)
      .then(() => settle({ kind: "copied" }))
      .catch((error: unknown) => settle({
        kind: "error",
        message: error instanceof Error ? error.message : t("share.copyError"),
      }));
  };

  const handleSave = () => {
    if (actionsDisabled) return;
    setExportState({ kind: "working", action: "save" });
    saveShareCardWithDialog(svg, exportSize.width, exportSize.height, `${fileName}-${storyOption.value}.png`)
      .then((result) => settle(result.cancelled ? { kind: "idle" } : { kind: "saved" }))
      .catch((error: unknown) => settle({
        kind: "error",
        message: error instanceof Error ? error.message : t("share.saveError"),
      }));
  };

  const handleSocialShare = (destination: ShareCardDestination) => {
    if (actionsDisabled) return;
    setExportState({ kind: "working", action: destination });
    // The product handoff is intentional: prepare the PNG first, then reveal the
    // composer with its ready-to-post caption and a clear ⌘V instruction.
    copyShareCardPng(svg, exportSize.width, exportSize.height)
      .then(() => openShareComposer(buildShareComposerUrl(destination, caption)))
      .then(() => settle({ kind: "shared", destination }))
      .catch((error: unknown) => settle({
        kind: "error",
        message: error instanceof Error ? error.message : t("share.postError"),
      }));
  };

  return (
    <>
      <div className="auth-modal__overlay" onClick={onClose}>
        <section
          className="auth-modal profile-modal share-card-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t(card.kind === "week" ? "share.dialog.weekAria" : "share.dialog.dayAria")}
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label={t("share.close")} onClick={onClose} />

          <div className="share-card-modal__body">
            <div className={`share-card-stage share-card-stage--${defaultTheme} share-card-stage--landscape`}>
              <button
                type="button"
                className="share-card-stage__arrow share-card-stage__arrow--previous"
                aria-label={t("share.previous")}
                disabled={working}
                onClick={() => selectStory(storyIndex - 1)}
              >
                <ChevronIcon direction="previous" />
              </button>
              <img
                key={storyOption.value}
                className="share-card-stage__preview"
                src={previewSrc}
                alt={`${previewAlt} — ${storyLabel(storyIndex, storyOption.label)}`}
              />
              <button
                type="button"
                className="share-card-stage__arrow share-card-stage__arrow--next"
                aria-label={t("share.next")}
                disabled={working}
                onClick={() => selectStory(storyIndex + 1)}
              >
                <ChevronIcon direction="next" />
              </button>
            </div>

            <div className="share-card-gallery-meta">
              <div className="share-card-gallery-dots" role="radiogroup" aria-label={t("share.storyAria")}>
                {storyOptions.map((option, index) => (
                  <button
                    key={option.value}
                    type="button"
                    className={index === storyIndex ? "is-active" : ""}
                    role="radio"
                    aria-checked={index === storyIndex}
                    aria-label={storyLabel(index, option.label)}
                    disabled={working}
                    onClick={() => selectStory(index)}
                  />
                ))}
              </div>
            </div>

            {rankGate && onJoinLeaderboard ? (
              <div className="share-card-rank-gate" role="status">
                <span>{rankGate.detail}</span>
                {rankGate.action === "join" ? (
                  <button type="button" disabled={joiningLeaderboard} onClick={handleJoinLeaderboard}>
                    {joiningLeaderboard ? t("leaderboard.joining") : t("leaderboard.join")}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="share-card-options" aria-label={t("share.optionsAria")}>
              <div className="share-card-destinations">
                <div className="share-card-destinations__grid">
                  <button
                    type="button"
                    className="share-card-destination share-card-destination--copy"
                    disabled={actionsDisabled}
                    aria-busy={working}
                    onClick={handleCopy}
                  >
                    <span>{exportState.kind === "working" && exportState.action === "copy" ? t("share.copying") : t("share.copyImage")}</span>
                    <CopyIcon />
                  </button>
                  <button
                    type="button"
                    className="share-card-destination share-card-destination--icon share-card-destination--save"
                    disabled={actionsDisabled}
                    aria-busy={working}
                    aria-label={t("share.savePng")}
                    title={t("share.savePng")}
                    onClick={handleSave}
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    type="button"
                    className="share-card-destination share-card-destination--icon share-card-destination--x"
                    disabled={actionsDisabled}
                    aria-busy={working}
                    aria-label={exportState.kind === "working" && exportState.action === "x" ? t("share.preparingFor", { destination: "X" }) : "X"}
                    title={t("share.openDestination", { destination: "X" })}
                    onClick={() => handleSocialShare("x")}
                  >
                    <XIcon />
                  </button>
                  <button
                    type="button"
                    className="share-card-destination share-card-destination--icon share-card-destination--linkedin"
                    disabled={actionsDisabled}
                    aria-busy={working}
                    aria-label={exportState.kind === "working" && exportState.action === "linkedin" ? t("share.preparingFor", { destination: "LinkedIn" }) : "LinkedIn"}
                    title={t("share.openDestination", { destination: "LinkedIn" })}
                    onClick={() => handleSocialShare("linkedin")}
                  >
                    <LinkedInIcon />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <ShareCardToast state={exportState} />
    </>
  );
}

function ShareCardToast({ state }: { readonly state: ExportState }) {
  const { t } = useLocalization();
  if (state.kind === "idle" || state.kind === "working") return null;

  const copy = state.kind === "copied"
    ? { title: t("share.toast.copied"), detail: t("share.toast.paste"), tone: "success" }
    : state.kind === "saved"
      ? { title: t("share.toast.saved"), detail: t("share.toast.savedDetail"), tone: "success" }
      : state.kind === "shared"
        ? { title: t("share.toast.copied"), detail: t("share.toast.composer", { destination: state.destination === "linkedin" ? "LinkedIn" : "X" }), tone: "success" }
        : { title: t("share.toast.error"), detail: state.message, tone: "error" };

  return (
    <div className="share-card-toast" data-tone={copy.tone} role={copy.tone === "error" ? "alert" : "status"}>
      <strong>{copy.title}</strong>
      <span>{copy.detail}</span>
    </div>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="2.7" />
      <path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0-.02-5ZM3 9h4v12H3V9ZM9 9h3.8v1.7h.05c.5-1 1.8-2 3.7-2 3.9 0 4.6 2.6 4.6 5.9V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9V9Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.2-8.2L2.8 2h6.4l4.4 5.8L18.9 2Zm-1.1 17.9h1.7L8.3 4H6.5l11.3 15.9Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 8h10v11H9zM5 16H3V4h11v2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m-4-4 4 4 4-4M5 19h14" />
    </svg>
  );
}

function ChevronIcon({ direction }: { readonly direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === "previous" ? "m14.5 5-7 7 7 7" : "m9.5 5 7 7-7 7"} />
    </svg>
  );
}
