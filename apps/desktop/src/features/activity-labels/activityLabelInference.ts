import {
  parseActivityTimelineCardOutput,
  type ActivityTimelineCardModelItem,
  type ActivityTimelineCardPromptInput,
} from "@drifty/domain";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import {
  createAnalysisTextInference,
  type AnalysisInferenceProtocol,
  type AnalysisTextInference,
  type ProjectPassInferenceDeps,
} from "../classification/projectPassInference";

// Must match TIMELINE_CARD_SENTINEL in the edge
// (supabase/functions/review-activity/timelineCardWindow.ts).
const TIMELINE_CARD_SENTINEL = "driftyTimelineCardWindow";

/**
 * Drifty Cloud receives the window's listed records rather than the prompt
 * text and builds the same prompt on the server, so the paid model only ever
 * sees the card prompt. Other providers get the prompt itself.
 */
export function buildTimelineCardCloudContent(input: ActivityTimelineCardPromptInput): string {
  return JSON.stringify({ [TIMELINE_CARD_SENTINEL]: input });
}

/**
 * One activity window (up to three hours) per request. A missing answer simply
 * keeps the existing block display. The budget matches the project pass on the
 * same Drifty Cloud route: a dense three-hour window took 65 seconds there, one
 * request ran past two minutes, and reasoning models count their thinking
 * against the output tokens.
 */
export const ACTIVITY_LABEL_PROTOCOL: AnalysisInferenceProtocol<ActivityTimelineCardModelItem[], ActivityTimelineCardPromptInput> = {
  parse: (content) => parseActivityTimelineCardOutput(content),
  repairInstruction:
    'The previous response was not valid JSON. Return only {"cards":[...]} with start_ref, end_ref, status, title, description and refs for each card. No markdown, comments, or explanations.',
  // The edge consumes one structured card window, not a multi-turn chat. A malformed
  // answer stays retryable through the existing window backoff without spending project quota.
  cloudJsonRepair: false,
  maxTokens: 8192,
  timeoutMs: 180_000,
  cloudContent: (prompt, input) => (input ? buildTimelineCardCloudContent(input) : prompt),
};

export type ActivityLabelInference = AnalysisTextInference<ActivityTimelineCardModelItem[], ActivityTimelineCardPromptInput>;

export function createActivityLabelInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps): ActivityLabelInference {
  return createAnalysisTextInference(setup, deps, ACTIVITY_LABEL_PROTOCOL);
}
