import { describe, expect, it } from "vitest";
import { normalizeScreenImages, MAX_SCREEN_IMAGE_BASE64, withScreenImages } from "./screenImages";

const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=";
const image = { mediaType: "image/png" as const, data, offsetSeconds: 5 };
describe("transient screen images", () => {
  it("validates a bounded PNG without accepting URLs, oversized or unrelated fields", () => {
    expect(normalizeScreenImages([image])).toEqual([image]);
    expect(normalizeScreenImages(undefined)).toEqual([]);
    for (const value of [null, {}, [image, image, image, image], [{ ...image, url: "https://example.com" }],
      [{ ...image, data: "https://example.com" }], [{ ...image, mediaType: "image/jpeg" }],
      [{ ...image, data: data + "A".repeat(MAX_SCREEN_IMAGE_BASE64) }], [{ ...image, offsetSeconds: NaN }]]) {
      expect(normalizeScreenImages(value)).toBeNull();
    }
  });
  it("keeps pixels out of the text prompt and labels the right activity with a shared three-image cap", () => {
    const messages = [{ role: "system", content: "instructions" }, { role: "user", content: "activities" }];
    const items = [{ id: "activity-one", screenImages: [image, image] }, { id: "activity-two", screenImages: [image, image] }];
    for (const format of ["anthropic", "openai"] as const) {
      const result = format === "anthropic" ? withScreenImages(messages, items, format) : withScreenImages(messages, items, format);
      expect(result[0]).toEqual(messages[0]);
      const blocks = result[1].content;
      expect(Array.isArray(blocks)).toBe(true);
      if (typeof blocks === "string") throw new Error("missing image blocks");
      const texts = blocks.filter(block => block.type === "text").map(block => block.text).join("\n");
      expect(texts).toContain('"activityId":"activity-two"');
      expect(texts).toContain("unsent draft");
      expect(texts).not.toContain(data);
      expect(blocks.filter(block => block.type !== "text")).toHaveLength(3);
    }
    expect(withScreenImages(messages, [], "anthropic")).toEqual(messages);
  });
});
