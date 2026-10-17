import { useEffect, useMemo, useRef, useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
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
import { useShareCardCommunityModels } from "./useShareCardCommunityModels";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { detectHostPlatform, type HostPlatform } from "../../lib/api/accessibilityClient";

import { useShareCardPreview } from "./useShareCardPreview";
import { describeActionError } from "../../lib/actionErrors";
import { copyTextToClipboard } from "../../lib/clipboard";

export type ShareCardModalCard =
  | { readonly kind: "day"; readonly data: ShareCardData }
  | { readonly kind: "week"; readonly data: ShareWeekCardData };

type ShareCardModalProps = {
  readonly card: ShareCardModalCard;
  readonly defaultTheme: ShareCardTheme;
  /** Opens the existing aggregate-only leaderboard opt-in flow. */
  readonly accountScope?: string | null;
  readonly comparisonWindowKey?: string;
  readonly onJoinLeaderboard?: () => Promise<void>;
  /**
   * Stories to offer, in order. Callers whose card lacks some aggregates (the
   * leaderboard has no category totals) narrow the list; the default follows
   * the card kind.
   */
  readonly storyIds?: readonly UnifiedShareStoryId[];
  /** A live public profile URL. Adds a "Copy profile link" action and joins the post caption. */
  readonly profileLinkUrl?: string | null;
  readonly onClose: () => void;
};

const STORY_OPTIONS = UNIFIED_STORY_OPTIONS;
const SHARE_CARD_FORMAT = "landscape" as const;

const DAY_STORIES = new Set<UnifiedShareStoryId>(["R1c", "R2", "R4", "F1", "C1", "X4", "X5"]);
const WEEK_STORIES = new Set<UnifiedShareStoryId>(["WR1", "W5", "X4", "X5"]);
// The weekly placement is exact only when the card covers the weekly rank
// window, so callers opt in through `storyIds` (the leaderboard does); the
// calendar-week dashboard card would always show it locked.
const WEEK_OPT_IN_STORIES = new Set<UnifiedShareStoryId>([...WEEK_STORIES, "WR4"]);
// Estimates require a fresh real-participant model. Only the place-rank stories
// claim an exact live position and therefore need leaderboard opt-in.
const EXACT_RANK_STORY_PERIOD: Partial<Record<UnifiedShareStoryId, "daily" | "weekly">> = {
  R4: "daily",
  WR4: "weekly",
};
const LIVE_RANK_STORY_PERIOD: Partial<Record<UnifiedShareStoryId, "daily" | "weekly">> = {
  R1c: "daily",
  R2: "daily",
  C1: "daily",
  R4: "daily",
  WR1: "weekly",
  WR4: "weekly",
};

type ExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly action: "copy" | "save" | ShareCardDestination }
  | { readonly kind: "copied" }
  | { readonly kind: "saved" }
  | { readonly kind: "shared"; readonly destination: ShareCardDestination }
  | { readonly kind: "error"; readonly message: string; readonly detail: string | null };

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

function storyOptionsForCard(card: ShareCardModalCard, storyIds?: readonly UnifiedShareStoryId[]) {
  if (storyIds && storyIds.length > 0) {
    const allowed = card.kind === "day" ? DAY_STORIES : WEEK_OPT_IN_STORIES;
    return storyIds
      .filter((id) => allowed.has(id))
      .map((id) => STORY_OPTIONS.find((option) => option.value === id))
      .filter((option): option is (typeof STORY_OPTIONS)[number] => option !== undefined);
  }
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

export function ShareCardModal({ card, defaultTheme, accountScope = null, comparisonWindowKey = "", onJoinLeaderboard, storyIds, profileLinkUrl = null, onClose }: ShareCardModalProps) {
  const { effectiveLanguage, t } = useLocalization();
  const hostPlatform = useMemo(() => detectHostPlatform(), []);
  const [selectedStoryId, setSelectedStoryId] = useState<UnifiedShareStoryId | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });
  const [joiningLeaderboard, setJoiningLeaderboard] = useState(false);
  const [profileLinkState, setProfileLinkState] = useState<"idle" | "copied" | "error">("idle");
  const exportGenerationRef = useRef(0);
  const exportTarget = `${card.kind === "day" ? card.data.day : card.data.startDay + ":" + card.data.endDay}:${defaultTheme}:${accountScope}:${comparisonWindowKey}`;
  useEffect(() => {
    exportGenerationRef.current += 1;
    // Invalidate old feedback, but finish an in-flight export before enabling another.
    setExportState((current) => current.kind === "working" ? current : { kind: "idle" });
    return () => { exportGenerationRef.current += 1; };
  }, [exportTarget]);
  const storyOptions = useMemo(() => storyOptionsForCard(card, storyIds), [card, storyIds]);
  const storyOption = storyOptions.find((option) => option.value === selectedStoryId) ?? storyOptions[0] ?? STORY_OPTIONS[0];
  const storyIndex = Math.max(0, storyOptions.findIndex((option) => option.value === storyOption.value));
  const rankStoryPeriod = EXACT_RANK_STORY_PERIOD[storyOption.value];
  const liveRankStoryPeriod = LIVE_RANK_STORY_PERIOD[storyOption.value];
  // Rank stories prefer an opted-in aggregate leaderboard fact for the exact
  // matching window. Estimates use the same model as achievement alerts.
  const { state: liveRankState, refresh: refreshLiveRanks } = useShareCardLiveRanks(Boolean(onJoinLeaderboard), accountScope, comparisonWindowKey);
  const { models: communityModels, loading: communityModelsLoading } = useShareCardCommunityModels();
  const rankGate = rankGateForStory(card, storyOption.value, liveRankState, t);
  const lockedRankPeriod = rankGate && rankStoryPeriod ? rankStoryPeriod : null;
  // Preserve the established Korean-to-English export contract; other supported languages follow the UI.
  const cardLanguage = effectiveLanguage === "ko" ? "en" : effectiveLanguage;
  // Only a non-member is asked to join; a member's rank is loading or not yet
  // published for this window.
  const lockedRankReason = rankGate?.action === "join" ? "join" : "pending";
  const matchingLiveRanks = useMemo<ShareCardLiveRanks>(() => ({
    daily: card.kind === "day" && rankMatchesCard(card, liveRankState.daily) ? liveRankState.daily.rank : null,
    weekly: card.kind === "week" && rankMatchesCard(card, liveRankState.weekly) ? liveRankState.weekly.rank : null,
  }), [card, liveRankState.daily, liveRankState.weekly]);

  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const dialogRef = useRef<HTMLElement | null>(null);
  useAnchoredDialog(dialogRef);

  const svg = useMemo(() => {
    if (lockedRankPeriod) {
      return renderLockedShareRankSvg({
        theme: defaultTheme,
        period: lockedRankPeriod,
        lookIndex: storyIndex,
        language: cardLanguage,
        reason: lockedRankReason,
      });
    }
    return card.kind === "week"
      ? renderShareWeekCardSvg({ data: card.data, format: SHARE_CARD_FORMAT, theme: defaultTheme, language: cardLanguage, story: storyOption.value, lookIndex: storyIndex, liveRanks: matchingLiveRanks, communityModels })
      : renderShareCardSvg({ data: card.data, format: SHARE_CARD_FORMAT, theme: defaultTheme, language: cardLanguage, story: storyOption.value, lookIndex: storyIndex, liveRanks: matchingLiveRanks, communityModels });
  }, [card, cardLanguage, defaultTheme, matchingLiveRanks, communityModels, lockedRankPeriod, lockedRankReason, storyIndex, storyOption.value]);
  const previewAlt = card.kind === "week"
    ? t("share.previewWeekAria", { week: card.data.weekLabel, range: card.data.rangeLabel })
    : t("share.previewDayAria", { day: `${card.data.weekdayLabel} ${card.data.dateLabel}` });
  const storyLabel = (index: number, fallback: string) => effectiveLanguage !== "en" ? t("share.storyLabel", { index: index + 1 }) : fallback;
  const fileName = card.kind === "week"
    ? `drifty-week-${card.data.startDay}`
    : `drifty-${card.data.day}`;
  const previewSrc = useMemo(() => shareCardSvgDataUrl(svg), [svg]);
  const comparisonLoading = Boolean(liveRankStoryPeriod) && (
    liveRankState[liveRankStoryPeriod ?? "daily"].availability === "loading"
    || (!rankStoryPeriod && communityModelsLoading && !matchingLiveRanks[liveRankStoryPeriod ?? "daily"])
  );
  const preview = useShareCardPreview(previewSrc, !comparisonLoading);
  const exportSize = SHARE_CARD_EXPORT_SIZES[SHARE_CARD_FORMAT] ?? SHARE_CARD_UNIFIED_SIZE;
  const working = exportState.kind === "working";
  const actionsDisabled = working || lockedRankPeriod !== null || comparisonLoading || preview.pending;
  const caption = profileLinkUrl ? `${buildShareCardCaption()}\n${profileLinkUrl}` : buildShareCardCaption();

  useEffect(() => {
    if (exportState.kind === "idle" || exportState.kind === "working" || exportState.kind === "error") return;
    const timeout = window.setTimeout(() => setExportState({ kind: "idle" }), 3_400);
    return () => window.clearTimeout(timeout);
  }, [exportState]);

  useEffect(() => {
    if (profileLinkState !== "copied") return;
    const timeout = window.setTimeout(() => setProfileLinkState("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [profileLinkState]);

  const handleCopyProfileLink = () => {
    if (!profileLinkUrl) return;
    // Called directly from the click so WebKit keeps the user gesture.
    copyTextToClipboard(profileLinkUrl)
      .then(() => setProfileLinkState("copied"))
      .catch(() => setProfileLinkState("error"));
  };

  const selectStory = (nextIndex: number) => {
    if (working || storyOptions.length === 0) return;
    const normalizedIndex = (nextIndex + storyOptions.length) % storyOptions.length;
    setSelectedStoryId(storyOptions[normalizedIndex]?.value ?? storyOption.value);
    setExportState({ kind: "idle" });
  };

  const handleJoinLeaderboard = () => {
    if (!onJoinLeaderboard || joiningLeaderboard) return;
    setJoiningLeaderboard(true);
    const generation = exportGenerationRef.current;
    onJoinLeaderboard()
      .then(() => refreshLiveRanks())
      .catch((error: unknown) => {
        if (exportGenerationRef.current !== generation) return;
        settle({ kind: "error", ...describeActionError(error, t("share.joinError")) }, generation);
      })
      .finally(() => setJoiningLeaderboard(false));
  };

  const settle = (state: ExportState, generation: number) => {
    setExportState((current) => {
      if (exportGenerationRef.current === generation) return state;
      return current.kind === "working" ? { kind: "idle" } : current;
    });
  };

  const handleCopy = () => {
    if (actionsDisabled) return;
    const generation = exportGenerationRef.current;
    setExportState({ kind: "working", action: "copy" });
    // Keep the ClipboardItem creation synchronous within the click gesture —
    // WebKit rejects clipboard writes that start after an intervening await.
    copyShareCardPng(svg, exportSize.width, exportSize.height)
      .then(() => settle({ kind: "copied" }, generation))
      .catch((error: unknown) => settle({
        kind: "error",
        ...describeActionError(error, t("share.copyError")),
      }, generation));
  };

  const handleSave = () => {
    if (actionsDisabled) return;
    const generation = exportGenerationRef.current;
    setExportState({ kind: "working", action: "save" });
    saveShareCardWithDialog(svg, exportSize.width, exportSize.height, `${fileName}-${storyOption.value}.png`)
      .then((result) => settle(result.cancelled ? { kind: "idle" } : { kind: "saved" }, generation))
      .catch((error: unknown) => settle({
        kind: "error",
        ...describeActionError(error, t("share.saveError")),
      }, generation));
  };

  const handleSocialShare = (destination: ShareCardDestination) => {
    if (actionsDisabled) return;
    const generation = exportGenerationRef.current;
    setExportState({ kind: "working", action: destination });
    // The product handoff is intentional: prepare the PNG first, then reveal the
    // composer with its ready-to-post caption and a clear paste instruction.
    copyShareCardPng(svg, exportSize.width, exportSize.height)
      .then(() => openShareComposer(buildShareComposerUrl(destination, caption, hostPlatform)))
      .then(() => settle({ kind: "shared", destination }, generation))
      .catch((error: unknown) => settle({
        kind: "error",
        ...describeActionError(error, t("share.postError")),
      }, generation));
  };

  return (
    <>
      <div className="auth-modal__overlay" {...overlayDismiss}>
        <section
          ref={dialogRef}
          className="auth-modal share-card-modal"
          role="dialog"
          data-modal-motion-panel
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
              {preview.src ? (
                <img
                  className="share-card-stage__preview"
                  src={preview.src}
                  aria-busy={preview.pending}
                  alt={`${previewAlt} — ${storyLabel(storyIndex, storyOption.label)}`}
                />
              ) : null}
              {!preview.src && !preview.failed ? (
                <div className="share-card-stage__loading" role="status">{t("share.loadingComparison")}</div>
              ) : null}
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

            {rankGate && onJoinLeaderboard && !comparisonLoading ? (
              <div className="share-card-rank-gate" role="status">
                <span>{rankGate.detail}</span>
                {rankGate.action === "join" ? (
                  <button type="button" disabled={joiningLeaderboard} aria-busy={joiningLeaderboard} onClick={handleJoinLeaderboard}>
                    <ActionLabel busy={joiningLeaderboard} busyLabel={t("leaderboard.joining")}>{t("leaderboard.join")}</ActionLabel>
                  </button>
                ) : null}
              </div>
            ) : null}

            {preview.failed ? (
              <div className="share-card-rank-gate" role="alert">{t("share.postError")}</div>
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
                    <ActionLabel busy={exportState.kind === "working" && exportState.action === "copy"} busyLabel={t("share.copying")}>{t("share.copyImage")}</ActionLabel>
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
                    <ActionLabel busy={exportState.kind === "working" && exportState.action === "save"}><DownloadIcon /></ActionLabel>
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
                    <ActionLabel busy={exportState.kind === "working" && exportState.action === "x"}><XIcon /></ActionLabel>
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
                    <ActionLabel busy={exportState.kind === "working" && exportState.action === "linkedin"}><LinkedInIcon /></ActionLabel>
                  </button>
                </div>
              </div>
              {/* A failed export reports under the buttons that retry it. The
                  dialog's top is anchored, so the line only extends the bottom edge. */}
              {exportState.kind === "error" ? <p className="share-card-outcome" role="alert" title={exportState.detail ?? undefined}>{exportState.message}{exportState.detail ? <span className="sr-only"> {exportState.detail}</span> : null}</p> : null}
              {profileLinkUrl ? (
                <div className="share-card-profile-link">
                  <button type="button" className="share-card-profile-link__button" onClick={handleCopyProfileLink}>
                    {profileLinkState === "copied" ? <CheckIcon /> : <LinkIcon />}
                    <span>{profileLinkState === "copied" ? t("share.profileLinkCopied") : t("share.copyProfileLink")}</span>
                  </button>
                  <span className="sr-only" role="status">{profileLinkState === "copied" ? t("share.profileLinkCopied") : ""}</span>
                  {profileLinkState === "error" ? <p className="share-card-outcome" role="alert">{t("share.profileLinkError")}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
      <ShareCardToast state={exportState} hostPlatform={hostPlatform} />
    </>
  );
}

function ShareCardToast({ state, hostPlatform }: { readonly state: ExportState; readonly hostPlatform: HostPlatform }) {
  const { t } = useLocalization();
  if (state.kind === "idle" || state.kind === "working" || state.kind === "error") return null;

  // Only macOS has the save panel and ⌘; other desktop hosts save to Downloads and paste with Ctrl+V.
  const windows = hostPlatform !== "macos";
  const copy = state.kind === "copied"
    ? { title: t("share.toast.copied"), detail: t(windows ? "share.toast.pasteWindows" : "share.toast.paste"), tone: "success" }
    : state.kind === "saved"
      ? { title: t("share.toast.saved"), detail: t(windows ? "share.toast.savedDetailWindows" : "share.toast.savedDetail"), tone: "success" }
      : { title: t("share.toast.copied"), detail: t("share.toast.composer", { destination: state.destination === "linkedin" ? "LinkedIn" : "X" }), tone: "success" };

  return (
    <div className="share-card-toast" data-tone={copy.tone} role="status">
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

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
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
