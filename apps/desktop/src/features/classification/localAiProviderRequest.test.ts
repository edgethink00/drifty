import { describe, expect, it } from "vitest";
import { toLocalProviderRequest, type MinimizedActivityPayload } from "./localAiProviderRequest";

const basePayload: MinimizedActivityPayload = {
  segmentId: "segment-1",
  inputFingerprint: "fingerprint-1",
  startedAt: "2026-06-24T09:00:00.000Z",
  endedAt: "2026-06-24T09:05:00.000Z",
  durationSeconds: 300,
  appName: "Safari",
  bundleId: null,
  browserName: "Safari",
  siteDomain: "github.com",
  siteUrl: null,
  siteTitle: "Pull request",
  windowTitle: "Pull request",
  youtubeTitle: null,
  youtubeChannelName: null,
  youtubeCategory: null,
  youtubeIsShorts: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function promptFor(payload: readonly MinimizedActivityPayload[]): string {
  const request = toLocalProviderRequest(
    { provider: "self_hosted", baseUrl: "http://127.0.0.1:11434", model: "qwen-test" },
    payload,
    null,
  );
  expect(request).not.toBeNull();
  if (!request) return "";

  const messages = request.request["messages"];
  expect(Array.isArray(messages)).toBe(true);
  if (!Array.isArray(messages)) return "";

  const firstMessage = messages[0];
  expect(isRecord(firstMessage)).toBe(true);
  if (!isRecord(firstMessage)) return "";

  const content = firstMessage["content"];
  expect(typeof content).toBe("string");
  return typeof content === "string" ? content : "";
}

describe("toLocalProviderRequest", () => {
  it("omits Reddit-specific prompt guidance for non-Reddit payloads", () => {
    const prompt = promptFor([basePayload]);

    expect(prompt).not.toContain("Reddit-specific guidance");
    expect(prompt).not.toContain("redditCommunity");
  });

  it("adds Reddit-specific guidance and community context for Reddit payloads", () => {
    const prompt = promptFor([{
      ...basePayload,
      siteDomain: "reddit.com",
      siteTitle: "r/productivityapp - app recommendations",
      windowTitle: "r/productivityapp - Reddit",
      redditCommunity: "productivityapp",
    }]);

    expect(prompt).toContain("Reddit-specific guidance");
    expect(prompt).toContain("redditCommunity");
    expect(prompt).toContain("productivityapp");
  });
});
