import { invoke } from "@tauri-apps/api/core";
import { builtInCategoryOrUnknown } from "@drifty/domain";
import {
  classifyActivityDetailed,
  type ActivitySegment,
  type ClassificationOptions,
  type LiveClassificationMemoryContext,
} from "@drifty/domain";

import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import {
  AI_CLASSIFICATION_PROMPT_VERSION,
  toLiveClassificationPromptItem,
  toMinimizedPayload,
} from "./aiClassificationService";
import {
  CORRECTION_EVIDENCE_MAX_RECORDS,
  CORRECTION_EVIDENCE_SCHEMA,
  parseCorrectionEvidenceRecord,
  type CorrectionEvidenceRecord,
  type CorrectionEvidenceScope,
} from "./correctionEvidenceContract";
import { resolveLivingSoulForClassification } from "./livingSoul";
import type { ClassificationMemoryContext } from "./classificationMemoryContext";
import { correctionMemorySurfacesForSegments, scopeSoulToCorrectionSurfaces } from "./correctionMemorySurface";
import { buildRecentEpisodeContext } from "./recentEpisodeContext";
import type { SoulFeedback } from "./soulLearning";

const BROWSER_STORAGE_PREFIX = "drifty:correction-evidence:v1:";
const writeQueues = new Map<string, Promise<void>>();

export type CorrectionEvidencePrediction = Pick<
  CorrectionEvidenceRecord["predictionBeforeFeedback"],
  "category" | "productivity" | "confidence" | "source"
>;

export async function captureCorrectionEvidence(input: {
  readonly feedback: SoulFeedback;
  readonly correctionScope: CorrectionEvidenceScope;
  readonly contextSegments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly predictionBeforeFeedback?: CorrectionEvidencePrediction | null;
}): Promise<CorrectionEvidenceRecord> {
  const resolvedSoul = await resolveLivingSoulForClassification(true);
  if (!resolvedSoul) throw new Error("Correction evidence requires a local Living Soul identity.");
  const privacySettings = readAiPrivacyRequestSettings();
  const episode = buildRecentEpisodeContext({
    current: input.feedback.segment,
    segments: input.contextSegments,
    privacySettings,
  });
  const memoryContext: ClassificationMemoryContext = {
    soul: privacySettings.optional.workProfile ? resolvedSoul.promptContext : null,
    episodeByItemId: { [input.feedback.segment.id]: episode },
    correctionSurfaces: correctionMemorySurfacesForSegments([input.feedback.segment]),
  };
  const payload = await toMinimizedPayload(
    input.feedback.segment,
    null,
    privacySettings,
    memoryContext,
  );
  const record = await buildCorrectionEvidenceRecord({
    feedback: input.feedback,
    correctionScope: input.correctionScope,
    classificationOptions: input.classificationOptions,
    privacy: privacySettings.optional,
    payload,
    memoryContext,
    predictionBeforeFeedback: input.predictionBeforeFeedback,
  });
  await queueEvidenceWrite(resolvedSoul.scope, () => appendCorrectionEvidence(resolvedSoul.scope, record));
  return record;
}

export async function buildCorrectionEvidenceRecord(input: {
  readonly feedback: SoulFeedback;
  readonly correctionScope: CorrectionEvidenceScope;
  readonly classificationOptions: ClassificationOptions;
  readonly privacy: {
    readonly siteUrl: boolean;
    readonly windowTitle: boolean;
    readonly contentContext: boolean;
    readonly workProfile: boolean;
  };
  readonly payload: Awaited<ReturnType<typeof toMinimizedPayload>>;
  readonly memoryContext: ClassificationMemoryContext;
  readonly predictionBeforeFeedback?: CorrectionEvidencePrediction | null;
}): Promise<CorrectionEvidenceRecord> {
  const recordedAt = normalizedTimestamp(input.feedback.occurredAt);
  const prediction = input.predictionBeforeFeedback
    ?? classifyActivityDetailed(input.feedback.segment, input.classificationOptions);
  const item = toLiveClassificationPromptItem(input.payload, "current");
  const currentEpisode = input.memoryContext.episodeByItemId[input.feedback.segment.id];
  const promptMemoryContext: LiveClassificationMemoryContext = {
    soul: scopeSoulToCorrectionSurfaces(input.memoryContext.soul, input.memoryContext.correctionSurfaces, [input.feedback.segment.id]),
    episodeByItemId: currentEpisode ? { current: currentEpisode } : {},
  };
  const surfaceKey = await sha256Hex(JSON.stringify(surfaceIdentity(input.payload)));
  const detailKey = await sha256Hex(JSON.stringify(detailIdentity(item)));
  const eventId = await sha256Hex(JSON.stringify({
    source: input.feedback.segment.id,
    endedAt: input.feedback.segment.endedAt,
    recordedAt,
    kind: input.feedback.kind,
    surfaceKey,
    detailKey,
  }));
  const stored = input.feedback.segment.classification;
  const record: CorrectionEvidenceRecord = {
    schema: CORRECTION_EVIDENCE_SCHEMA,
    eventId,
    recordedAt,
    activityKeys: { surface: surfaceKey, detail: detailKey },
    // The evidence schema keeps the four metadata choices; screen text never joins a correction.
    privacy: {
      siteUrl: input.privacy.siteUrl,
      windowTitle: input.privacy.windowTitle,
      contentContext: input.privacy.contentContext,
      workProfile: input.privacy.workProfile,
    },
    promptInput: {
      promptVersion: AI_CLASSIFICATION_PROMPT_VERSION,
      item,
      workProfile: null,
      memoryContext: promptMemoryContext,
    },
    predictionBeforeFeedback: {
      category: builtInCategoryOrUnknown(prediction.category),
      productivity: prediction.productivity,
      confidence: boundedConfidence(prediction.confidence),
      source: prediction.source,
      model: boundedOptionalText(stored?.model, 160),
      promptVersion: boundedOptionalText(stored?.promptVersion, 160),
      inputFingerprint: boundedOptionalText(stored?.inputFingerprint, 200)
        ?? input.payload.inputFingerprint,
    },
    feedback: input.feedback.kind === "not_drift"
      ? {
          kind: "not_drift",
          scope: "alarm",
          productivityConstraint: "not_drift",
        }
      : {
          kind: "manual_correction",
          scope: input.correctionScope === "detail" ? "detail" : "surface",
          category: builtInCategoryOrUnknown(input.feedback.correctedCategory),
          productivity: input.feedback.correctedProductivity,
        },
  };
  return parseCorrectionEvidenceRecord(record);
}

async function appendCorrectionEvidence(scope: string, record: CorrectionEvidenceRecord): Promise<void> {
  const recordJson = JSON.stringify(record);
  if (isTauriRuntime()) {
    await invoke("correction_evidence_append", { scope, recordJson });
    return;
  }
  const storage = browserLocalStorage();
  if (!storage) throw new Error("Correction evidence storage is unavailable.");
  const key = `${BROWSER_STORAGE_PREFIX}${scope}`;
  const existing = (storage.getItem(key) ?? "").split("\n").filter(Boolean);
  const lines = [...existing, recordJson].slice(-CORRECTION_EVIDENCE_MAX_RECORDS);
  storage.setItem(key, `${lines.join("\n")}\n`);
}

function queueEvidenceWrite(scope: string, operation: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(scope) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeQueues.set(scope, next);
  void next.finally(() => {
    if (writeQueues.get(scope) === next) writeQueues.delete(scope);
  }).catch(() => undefined);
  return next;
}

function surfaceIdentity(payload: Awaited<ReturnType<typeof toMinimizedPayload>>): Record<string, string | null> {
  const domain = payload.siteDomain?.trim().toLocaleLowerCase() ?? null;
  return domain
    ? { kind: "site", target: domain }
    : {
        kind: "app",
        target: (payload.bundleId?.trim() || payload.appName.trim()).toLocaleLowerCase() || null,
      };
}

function detailIdentity(item: ReturnType<typeof toLiveClassificationPromptItem>): Record<string, unknown> {
  return {
    surface: {
      appName: item.appName?.trim().toLocaleLowerCase() ?? null,
      domain: item.domain?.trim().toLocaleLowerCase() ?? null,
    },
    siteUrl: item.siteUrl?.trim().toLocaleLowerCase() ?? null,
    windowTitle: item.windowTitle?.trim().toLocaleLowerCase() ?? null,
    title: item.title?.trim().toLocaleLowerCase() ?? null,
    youtubeChannelName: item.youtubeChannelName?.trim().toLocaleLowerCase() ?? null,
    redditCommunity: item.redditCommunity?.trim().toLocaleLowerCase() ?? null,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Correction evidence timestamp must be ISO-8601.");
  return new Date(parsed).toISOString();
}

function boundedConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function boundedOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value?.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
