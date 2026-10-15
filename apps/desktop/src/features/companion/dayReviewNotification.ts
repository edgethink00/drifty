import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { sendNativeNotification } from "../../lib/api/nativeNotificationClient";
import { isQuietCloudPause } from "../classification/classificationAvailability";
import type { DisplayLanguage } from "../localization/languagePreference";
import { translateFor } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import type { EndOfDayReviewEvent, EndOfDayReviewPendingAssessment } from "./endOfDayReviewModel";

/**
 * The scheduled Day Review is a system notification and nothing else
 * (product decision 2026-10-12). A review is not a decision to make right
 * now, does not go stale, and arrives at the same time every day, so it waits
 * in Notification Center instead of rising over the user's work. Clicking it
 * brings Drifty forward.
 *
 * On macOS the review goes through UNUserNotificationCenter, which asks for
 * permission the first time and reports the answer. Notifications turned off
 * for Drifty close the evening ("denied"); Settings shows why. A notification
 * that cannot be sent for another reason (outside the Tauri main window, an
 * unanswered permission request, a rejected command) shows nothing in its
 * place: the scheduler tries once more within its presentation allowance and
 * then lets the evening pass. Windows and a Drifty process outside an app
 * bundle keep the notification plugin, which cannot read permission.
 */

export type DayReviewNotificationResult = "sent" | "denied" | "unavailable" | "cancelled" | "failed";

export type DayReviewNotificationContent = {
  readonly title: string;
  readonly body: string;
};

/** A change smaller than this reads as "no change" and is left out. */
const COMPARISON_MIN_SECONDS = 60;

/**
 * Title: the day in one sentence. Body: what the title does not say, in one
 * plain line. While AI has not rated the day, focus, drift, comparison and
 * rank are withheld, as everywhere else the review is shown.
 */
export function buildDayReviewNotification(event: EndOfDayReviewEvent, language: DisplayLanguage): DayReviewNotificationContent {
  const t = translateFor(language);
  /* The shared compact format prints a bare "0" for no time; the review always names the unit. */
  const duration = (seconds: number) => (seconds < 60
    ? (language === "ko" ? "0분" : "0m")
    : formatLocalizedCompactDurationFromSeconds(seconds, language));
  const totalSeconds = Math.max(0, event.totalSeconds);
  const pending = event.assessment?.state === "pending" ? event.assessment : null;

  if (pending) {
    const facts = isQuietCloudPause(pending)
      ? (event.sourceSummaries ?? []).slice(0, 2).map((source) => source.appName + " " + duration(source.durationSeconds))
      : [t(pendingAssessmentTitleKey(pending.reason))];
    return {
      title: t("companion.dayReview.notification.titleTracked", { duration: duration(totalSeconds) }),
      body: sentenceCase(facts.join(" · "), language),
    };
  }

  const focusSeconds = Math.max(0, event.focusSeconds);
  const facts: string[] = [];
  const comparison = event.comparison;
  const focusDelta = comparison?.focusDeltaSeconds ?? 0;
  if (comparison && Math.abs(focusDelta) >= COMPARISON_MIN_SECONDS) {
    facts.push(t(comparisonKey(focusDelta > 0, comparison.scope === "wholeDay"), { duration: duration(Math.abs(focusDelta)) }));
  } else if (totalSeconds > 0) {
    facts.push(t("companion.dayReview.notification.share", {
      percent: String(Math.round((focusSeconds / totalSeconds) * 100)),
      duration: duration(totalSeconds),
    }));
  }
  const runSeconds = event.dailySignals?.longestFocusRunSeconds ?? 0;
  if (runSeconds >= COMPARISON_MIN_SECONDS) {
    const startedAt = event.dailySignals?.longestFocusRunStartedAt ? new Date(event.dailySignals.longestFocusRunStartedAt) : null;
    facts.push(startedAt && Number.isFinite(startedAt.getTime())
      ? t("companion.dayReview.notification.bestRun", { duration: duration(runSeconds), time: formatClock(startedAt, language) })
      : t("companion.dayReview.notification.bestRunNoTime", { duration: duration(runSeconds) }));
  }
  const rank = event.leaderboardCelebration;
  if (rank) facts.push(t("companion.dayReview.notification.rank", { rank: rank.rank, count: rank.participantCount }));
  return {
    title: t("companion.dayReview.notification.title", { duration: duration(focusSeconds) }),
    body: sentenceCase(facts.join(" · "), language),
  };
}

/**
 * Hands the review to the OS and reports whether that worked. The plugin
 * fallback awaits the plugin's own notify command: its public
 * sendNotification() returns before the command runs, so a rejected command
 * would otherwise still look sent and close the day.
 */
export async function sendDayReviewNotification(
  event: EndOfDayReviewEvent,
  language: DisplayLanguage,
  commitPresentation: () => boolean = () => true,
): Promise<DayReviewNotificationResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return "unavailable";
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label !== "main") return "unavailable";
    const content = buildDayReviewNotification(event, language);
    if (!commitPresentation()) return "cancelled";
    const native = await sendNativeNotification({
      /* One per day: sending the same day again replaces it in Notification Center. */
      identifier: "drifty.day-review." + event.day,
      title: content.title,
      body: content.body,
    });
    if (native === "sent") return "sent";
    if (native === "denied") return "denied";
    if (native === "notDetermined") return "failed";
    const { invoke } = await import("@tauri-apps/api/core");
    if (!commitPresentation()) return "cancelled";
    await invoke("plugin:notification|notify", { options: { title: content.title, body: content.body } });
    return "sent";
  } catch {
    return "failed";
  }
}

/**
 * 10:20 → "10:20 AM" / "오전 10:20". Written out rather than left to Intl so
 * the Korean day half reads the same in every runtime that builds the text.
 */
function formatClock(date: Date, language: DisplayLanguage): string {
  const hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  if (language === "ko") return (hour < 12 ? "오전 " : "오후 ") + hour12 + ":" + minutes;
  return hour12 + ":" + minutes + " " + (hour < 12 ? "AM" : "PM");
}

function comparisonKey(more: boolean, wholeDay: boolean): TranslationKey {
  if (wholeDay) return more ? "companion.dayReview.notification.moreThanDayBefore" : "companion.dayReview.notification.lessThanDayBefore";
  return more ? "companion.dayReview.notification.moreThanYesterday" : "companion.dayReview.notification.lessThanYesterday";
}

/* The card's own wording for why the day is not rated yet (CompanionPillDayReview). */
function pendingAssessmentTitleKey(reason: EndOfDayReviewPendingAssessment["reason"]): TranslationKey {
  if (reason === "cloud_quota_exceeded") return "companion.dayReview.pending.quotaExceeded";
  if (reason === "cloud_trial_expired") return "companion.dayReview.pending.trialEnded";
  if (reason === "cloud_payment_required" || reason === "cloud_billing_missing") {
    return "companion.dayReview.pending.cloudNeedsAttention";
  }
  if (reason === "provider_not_configured" || reason === "cloud_not_configured") {
    return "companion.dayReview.pending.connectAi";
  }
  return "companion.dayReview.pending.disconnected";
}

function sentenceCase(value: string, language: DisplayLanguage): string {
  return language === "en" ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
