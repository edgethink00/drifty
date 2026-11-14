import { activityTimeBounds, normalizeScreenImages, screenTextExcerpt, type ActivitySegment, type ScreenImage } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import { activityEvidenceSelectionForStretch } from "./activityEvidenceSelection";

export type ActivityVisualContext = { readonly text?: string; readonly images: readonly ScreenImage[] };
export type ActivityVisualReader = (segments: readonly ActivitySegment[]) => Promise<ReadonlyMap<string, ActivityVisualContext>>;

/** A single live item gets up to three frames. A batch shares the same three-image budget. */
export function imageLimits(count: number): number[] {
  if (count === 1) return [3];
  const selected = new Set([0, Math.round((count - 1) / 2), count - 1]);
  return Array.from({ length: count }, (_, index) => selected.has(index) ? 1 : 0);
}

export function createActivityVisualReader(client: ScreenContextClient): ActivityVisualReader {
  return async segments => {
    if (!client.isDesktop() || client.getSnapshot().connection !== "ready") return new Map();
    const wanted = segments.slice(0, 20).flatMap(segment => {
      const bounds = activityTimeBounds(segment);
      if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) return [];
      const selection = activityEvidenceSelectionForStretch([segment], Math.floor(bounds.start), Math.ceil(bounds.end));
      return selection ? [{ segment, selection, start: bounds.start, end: bounds.end }] : [];
    });
    if (!wanted.length) return new Map();
    const limits = imageLimits(wanted.length);
    let settled = false;
    const result = new Map<string, ActivityVisualContext>();
    const read = client.consume("screen_context_activity_input", {
      activities: wanted.map(({ selection }, i) => ({ ...selection, imageLimit: limits[i] })),
    }, raw => {
      if (!Array.isArray(raw) || raw.length !== wanted.length) throw new Error("screen_context_invalid_response");
      return raw.map((value, index) => {
        if (value === null) return { images: [] };
        if (!value || typeof value !== "object" || !Array.isArray(value.images)) throw new Error("screen_context_invalid_response");
        const text = value.text === null ? undefined : typeof value.text === "string" && value.text.length <= 3200 ? screenTextExcerpt(value.text) : undefined;
        const images = normalizeScreenImages(value.images.filter((v: unknown) => v !== null).map((image: Record<string, unknown>) => {
          if (typeof image.observedAtMs !== "number" || image.observedAtMs < wanted[index].start || image.observedAtMs >= wanted[index].end) throw new Error("screen_context_invalid_response");
          return { mediaType: image.mediaType, data: image.data, offsetSeconds: (image.observedAtMs - wanted[index].start) / 1000 };
        }));
        if (!images || images.length > limits[index]) throw new Error("screen_context_invalid_response");
        return { ...(text ? { text } : {}), images };
      });
    }, values => {
      if (!settled) values.forEach((value, index) => result.set(wanted[index].segment.id, value));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([read, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("screen_context_timeout")), 8000); })]);
      return result;
    } finally {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      void read.catch(() => undefined);
    }
  };
}
