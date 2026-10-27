import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import { learnLivingSoulFromFeedback, type SoulFeedbackKind, type SoulLearningProvider } from "./soulLearning";

const boundary = vi.hoisted(() => ({
  resolve: vi.fn(),
  save: vi.fn(),
  local: vi.fn(),
  cloud: vi.fn(),
}));

vi.mock("./livingSoul", async (original) => ({
  ...await original<typeof import("./livingSoul")>(),
  resolveLivingSoulForClassification: boundary.resolve,
  updateLivingSoulLearnedState: boundary.save,
}));
vi.mock("./managedLocalAiChat", () => ({ invokeOpenAiChatWithManagedLocalRetry: boundary.local }));
vi.mock("../../lib/supabase/client", () => ({ supabase: { functions: { invoke: boundary.cloud } } }));
vi.mock("../cloud-devices/cloudDeviceIdentity", () => ({ withCloudDevicePayload: async (body: unknown) => body }));
vi.mock("../settings/aiPrivacyRequestSettings", async (original) => ({
  ...await original<typeof import("../settings/aiPrivacyRequestSettings")>(),
  readAiPrivacyRequestSettings: () => ({
    version: 1,
    optional: { siteUrl: true, windowTitle: true, contentContext: true, workProfile: true },
  }),
}));

const segment: ActivitySegment = {
  id: "feedback-fixture",
  appName: "Google Chrome",
  siteDomain: "example.test",
  startedAt: "2026-10-28T09:00:00.000Z",
  endedAt: "2026-10-28T09:02:00.000Z",
  durationSeconds: 120,
  platform: "macos",
  source: "nsworkspace",
};
const providers: readonly SoulLearningProvider[] = [
  { kind: "none" },
  { kind: "cloud" },
  { kind: "local", provider: { provider: "managed_local", modelId: "drifty-qwen3-5-4b-default", baseUrl: "http://127.0.0.1:39217/v1", model: "local-four" } },
];
const feedbackKinds: readonly SoulFeedbackKind[] = ["manual_correction", "not_drift"];
const exclusions: readonly { name: string; fields: Partial<ActivitySegment> }[] = [
  { name: "user exclusion", fields: { exclusionSource: "user" } },
  { name: "default exclusion", fields: { exclusionSource: "default" } },
  { name: "legacy redacted marker", fields: { appName: "[Redacted]" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  const learned = { workSupport: [], drift: [], ambiguities: [] };
  boundary.resolve.mockResolvedValue({
    ownerId: "synthetic-owner",
    document: { revision: 1, learned },
    promptContext: {
      revision: 1,
      declared: { workActivities: ["Engineering"], workDomain: "Product", purpose: "Protect focus" },
      learnedWorkSupport: [], learnedDrift: [], ambiguities: [],
    },
  });
  boundary.save.mockResolvedValue(undefined);
  boundary.local.mockResolvedValue({ status: 500, body: "{}" });
  boundary.cloud.mockResolvedValue({ data: null, error: null });
});

describe("excluded feedback at the Soul learning boundary", () => {
  for (const provider of providers) {
    for (const kind of feedbackKinds) {
      for (const exclusion of exclusions) {
        it(`ignores ${exclusion.name} for ${kind} through ${provider.kind}`, async () => {
          const excluded: ActivitySegment = { ...segment, ...exclusion.fields };
          await learnLivingSoulFromFeedback({
            feedback: { kind, segment: excluded, correctedCategory: "utility", correctedProductivity: "neutral", occurredAt: excluded.endedAt },
            contextSegments: [excluded],
            provider,
          });

          expect(boundary.resolve).not.toHaveBeenCalled();
          expect(boundary.local).not.toHaveBeenCalled();
          expect(boundary.cloud).not.toHaveBeenCalled();
          expect(boundary.save).not.toHaveBeenCalled();
        });
      }
    }

    it(`still learns ordinary feedback through ${provider.kind}`, async () => {
      await learnLivingSoulFromFeedback({
        feedback: { kind: "manual_correction", segment, correctedCategory: "utility", correctedProductivity: "neutral", occurredAt: segment.endedAt },
        contextSegments: [segment],
        provider,
      });

      expect(boundary.resolve).toHaveBeenCalledTimes(2);
      expect(boundary.save).toHaveBeenCalledTimes(1);
      expect(boundary.local).toHaveBeenCalledTimes(provider.kind === "local" ? 1 : 0);
      expect(boundary.cloud).toHaveBeenCalledTimes(provider.kind === "cloud" ? 1 : 0);
      if (provider.kind === "cloud") {
        expect(boundary.cloud).toHaveBeenCalledWith("classify-activity", {
          body: expect.objectContaining({ mode: "refine_soul", feedback: expect.objectContaining({ activity: expect.objectContaining({ appName: "Google Chrome" }) }) }),
        });
      }
    });
  }
});
