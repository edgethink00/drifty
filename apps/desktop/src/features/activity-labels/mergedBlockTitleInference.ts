import { buildMergedBlockTitlePromptFromInput, type MergedBlockTitlePromptInput } from "@drifty/domain";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import {
  createAnalysisTextInference,
  type AnalysisInferenceProtocol,
  type AnalysisTextInference,
  type ProjectPassInferenceDeps,
} from "../classification/projectPassInference";

// The timeline card sentinel (activityLabelInference.ts): the edge reads the merged block's
// prompt version inside it, builds the prompt from the cards and claims the cards' quota pool.
// An edge without merged block names rejects that version before claiming anything.
const TIMELINE_CARD_SENTINEL = "driftyTimelineCardWindow";

export function buildMergedBlockTitleCloudContent(input: MergedBlockTitlePromptInput): string {
  return JSON.stringify({ [TIMELINE_CARD_SENTINEL]: input });
}

/**
 * One merged block's name from its cards' titles and minutes. The answer is the model's raw
 * text: whether it may be shown is decided against the block's cards (parseMergedBlockTitle).
 */
export const MERGED_BLOCK_TITLE_PROTOCOL: AnalysisInferenceProtocol<string, MergedBlockTitlePromptInput> = {
  parse: (content) => (content.includes("{") ? content : null),
  repairInstruction: 'The previous response was not valid JSON. Return only {"title": "..."} with no markdown or explanation.',
  cloudJsonRepair: false,
  maxTokens: 2048,
  timeoutMs: 60_000,
  localPrompt: buildMergedBlockTitlePromptFromInput,
  cloudContent: (prompt, input) => (input ? buildMergedBlockTitleCloudContent(input) : prompt),
};

export type MergedBlockTitleInference = AnalysisTextInference<string, MergedBlockTitlePromptInput>;

export function createMergedBlockTitleInference(setup: AnalysisAiSetupState, deps: ProjectPassInferenceDeps): MergedBlockTitleInference {
  return createAnalysisTextInference(setup, deps, MERGED_BLOCK_TITLE_PROTOCOL);
}
