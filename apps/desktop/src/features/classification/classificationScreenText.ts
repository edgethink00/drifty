import type { ActivitySegment } from "@drifty/domain";
import { screenTextNoticed, type ActivityScreenTextReader } from "../screen-context/screenTextUse";
import type { AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import type { MinimizedActivityPayload } from "./localAiProviderRequest";
import type { LocalAiProviderConfig } from "./localAiProviderRequest";
import type { ActivityVisualReader } from "../screen-context/screenVisualUse";

let reader: ActivityScreenTextReader | null = null;
let visualReader: ActivityVisualReader | null = null;
export function setClassificationVisualReader(next: ActivityVisualReader | null): () => void {
  visualReader = next;
  return () => { if (visualReader === next) visualReader = null; };
}
export function classificationSupportsImages(provider: LocalAiProviderConfig | null | undefined): boolean {
  if (!provider) return true;
  if (provider.provider === "anthropic") return provider.model.startsWith("claude-");
  return provider.provider === "openrouter_byok" && [provider.model, ...(provider.fallbackModels ?? [])].every(model => model.startsWith("anthropic/claude-"));
}

/** The main window registers its screen recording reader; returns the unregister call. */
export function setClassificationScreenTextReader(next: ActivityScreenTextReader | null): () => void {
  reader = next;
  return () => { if (reader === next) reader = null; };
}

/**
 * Adds each activity's screen text excerpt to the items about to go to the provider
 * (owner decision 2026-11-12). Only items that actually need an answer are read, after
 * cached and local answers are taken, and the excerpt joins no fingerprint, record or
 * sample. Without the switch, the notice, a reader or readable screens, items are unchanged.
 */
export async function withScreenText<T extends MinimizedActivityPayload>(
  payloads: readonly T[],
  segments: readonly ActivitySegment[],
  privacySettings: AiPrivacyRequestSettings,
  allowImages = false,
): Promise<T[]> {
  const current = reader;
  if (!current || payloads.length === 0 || !privacySettings.optional.screenText || !screenTextNoticed()) return [...payloads];
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const wanted = payloads.flatMap((payload) => byId.get(payload.segmentId) ?? []);
  const visual = visualReader;
  if (visual && allowImages) {
    try {
      const contexts = await visual(wanted);
      if (visualReader !== visual) return [...payloads];
      return payloads.map(payload => {
        const context = contexts.get(payload.segmentId);
        return context ? { ...payload, ...(context.text ? { screenText: context.text } : {}),
          ...(context.images.length ? { screenImages: context.images } : {}) } : payload;
      });
    } catch { /* Old native command or unavailable capture: retain the text path. */ }
  }
  let texts: ReadonlyMap<string, string>;
  try { texts = await current(wanted); } catch { return [...payloads]; }
  return payloads.map((payload) => {
    const screenText = texts.get(payload.segmentId);
    return screenText ? { ...payload, screenText } : payload;
  });
}
