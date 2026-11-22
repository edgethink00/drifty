/** Local desktop IPC only. These types must never enter cloud sync, learning
 * samples, telemetry, team, profile or leaderboard payloads. */
export interface ScreenContextReply<T> {
  readonly leaseId: string;
  readonly value: T;
}

export interface ScreenContextAccountBinding {
  readonly mode: "local" | "account";
  readonly expiresAtMs: number;
}

export interface ScreenCapturePreferences {
  readonly scope?: "selected_apps" | "active_display_scene";
  readonly generalNoticePending?: boolean;
  readonly enabled: boolean;
  readonly replayEnabled: boolean;
  readonly visibleTextEnabled: boolean;
  readonly ocrEnabled: boolean;
  readonly allowedApps: readonly string[];
  readonly intervalSeconds: 10 | 30;
}
export interface ScreenContextStatus {
  readonly activityCleanupPending?: boolean;
  readonly preferences: ScreenCapturePreferences;
  readonly preferencesInvalid: boolean;
  readonly captureEnabled: boolean;
  readonly globalPaused: boolean;
  readonly helperInstalled: boolean;
  readonly ocrSupported: boolean;
  readonly generalCaptureSupported?: boolean;
  readonly supportedApps: readonly { readonly id: string; readonly name: string }[];
  readonly paused: boolean;
  readonly running: boolean;
  readonly preparing: boolean;
  readonly accepted: number;
  readonly dropped: number;
  readonly lastFailure: ScreenContextFailure | null;
  readonly lastAcceptedAtMs: number | null;
}
export type ScreenContextFailure = "permission" | "excluded" | "visibility" | "protected" | "unsupported"
  | "cancelled" | "deadline" | "unavailable" | "invalidated" | "storage" | "no_text" | "text_deadline" | "text_unavailable"
  | "accessibility_permission" | "capture_retrying" | "capture_stopped" | "capture_declined";
export type ScreenTextSource = "none" | "ocr" | "accessibility";
export type ScreenTextState = "not_requested" | "recognized" | "no_text" | "deadline" | "unavailable";
export interface ScreenEvidenceSummary {
  readonly id: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly textSource: ScreenTextSource;
  readonly textState: ScreenTextState;
  readonly frameRetained: boolean;
}
export interface ScreenEvidenceCursor {
  readonly instance: string;
  readonly revision: number;
  readonly observedAtMs: number;
  readonly id: string;
  readonly order?: "oldest_first" | "newest_first";
}
export interface ScreenEvidencePage {
  readonly records: readonly ScreenEvidenceSummary[];
  readonly nextCursor: ScreenEvidenceCursor | null;
}
export interface ScreenEvidenceDetail {
  readonly id: string;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly textEvidence: { readonly source: ScreenTextSource; readonly state: ScreenTextState; readonly text: string };
  readonly frameUrl: string | null;
}
export interface ScreenEvidenceDeletion {
  readonly removedCount: number;
  readonly pendingFiles: number;
}
export interface ScreenDeletionPreview {
  readonly recordCount: number;
  /** Encrypted image bytes, excluding the shared catalog and filesystem overhead. */
  readonly imageBytes: number;
}

/** Separate native consent settings; saved choices are not active AI use. */
export type ScreenAiPurpose = "classification" | "project_assignment" | "timeline_cards";
export interface ScreenAiChoices {
  readonly accessibilityText: boolean;
  readonly ocrText: boolean;
  readonly images: boolean;
  readonly purposes: readonly ScreenAiPurpose[];
}
export interface ScreenAiRecipient {
  readonly policyVersion: 1;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly processing: "app_owned_local_runtime";
  readonly imagesSupported: boolean;
}
export interface ScreenAiSettings {
  readonly recipient: ScreenAiRecipient | null;
  readonly savedChoices: ScreenAiChoices | null;
  readonly preferencesInvalid: boolean;
  readonly active: boolean;
  readonly deliveryAvailable: boolean;
  readonly pendingReviewId: string | null;
}
export interface ScreenAiReview {
  readonly reviewId: string;
  readonly choices: ScreenAiChoices;
  readonly recipient: ScreenAiRecipient;
  readonly expiresAtMs: number;
}
