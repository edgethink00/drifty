import { parseActivityTimelineCardOutput, type ActivityTimelineCardModelItem } from "@drifty/domain";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import {
  createAnalysisTextInference,
  type AnalysisInferenceProtocol,
  type AnalysisTextInference,
  type ProjectPassInferenceDeps,
} from "../classification/projectPassInference";

/**
 * One activity window (up to three hours) per request. A missing answer simply
 * keeps the existing block display. The budget matches the project pass on the
 * same Drifty Cloud route: a dense three-hour window took 65 seconds there, one
 * request ran past two minutes, and reasoning models count their thinking
 * against the output tokens.
 */
export const ACTIVITY_LABEL_PROTOCOL: AnalysisInferenceProtocol<ActivityTimelineCardModelItem[]> = {
  parse: (content) => parseActivityTimelineCardOutput(content),
  repairInstruction:
    'The previous response was not valid JSON. Return only {"cards":[...]} with start_ref, end_ref, status, title, description and refs for each card. No markdown, comments, or explanations.',
  maxTokens: 8192,
  timeoutMs: 180_000,
  // Drifty Cloud's review endpoint accepts a plain prompt as its legacy
  // passthrough. It stores no structured sample for that shape.
  cloudContent: (prompt) => prompt,
};

export type ActivityLabelInference = AnalysisTextInference<ActivityTimelineCardModelItem[]>;

export function createActivityLabelInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps): ActivityLabelInference {
  return createAnalysisTextInference(setup, deps, ACTIVITY_LABEL_PROTOCOL);
}
