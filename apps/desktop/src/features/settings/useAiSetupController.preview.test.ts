import { describe, expect, it } from "vitest";

import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import { PREVIEW_AI_MOCK_BASE_URL } from "./previewAiContract";
import { resolvePreviewAwareInitialLocalAiSetup, toPersistedPreviewSafeLocalAiSetup } from "./useAiSetupController";

describe("resolvePreviewAwareInitialLocalAiSetup", () => {
  it("replaces the ordinary default custom endpoint with the built-in preview endpoint", () => {
    expect(resolvePreviewAwareInitialLocalAiSetup(DEFAULT_LOCAL_AI_SETUP, true, "1")).toEqual({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: PREVIEW_AI_MOCK_BASE_URL,
    });
  });

  it("preserves a user-entered endpoint in preview mode", () => {
    const setup = {
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: "http://127.0.0.1:11434/v1",
      selfHostedModel: "qwen-local",
    };

    expect(resolvePreviewAwareInitialLocalAiSetup(setup, true, "1")).toBe(setup);
  });

  it("does not affect ordinary non-preview runs", () => {
    expect(resolvePreviewAwareInitialLocalAiSetup(DEFAULT_LOCAL_AI_SETUP, false, "1")).toBe(DEFAULT_LOCAL_AI_SETUP);
    expect(resolvePreviewAwareInitialLocalAiSetup(DEFAULT_LOCAL_AI_SETUP, true, undefined)).toBe(DEFAULT_LOCAL_AI_SETUP);
  });

  it("removes a persisted preview-only endpoint outside preview mode", () => {
    expect(resolvePreviewAwareInitialLocalAiSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: PREVIEW_AI_MOCK_BASE_URL,
      selfHostedModel: "drifty-preview-fast",
    }, true, undefined)).toEqual(DEFAULT_LOCAL_AI_SETUP);
  });

  it("never writes the reserved preview endpoint into durable setup", () => {
    expect(toPersistedPreviewSafeLocalAiSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      provider: "self_hosted",
      selfHostedBaseUrl: PREVIEW_AI_MOCK_BASE_URL,
      selfHostedModel: "drifty-preview-fast",
    })).toMatchObject({
      provider: "self_hosted",
      selfHostedBaseUrl: DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
      selfHostedModel: "",
    });
  });

  it("also normalizes a trailing-slash preview endpoint before persistence", () => {
    expect(toPersistedPreviewSafeLocalAiSetup({
      ...DEFAULT_LOCAL_AI_SETUP,
      selfHostedBaseUrl: `${PREVIEW_AI_MOCK_BASE_URL}/`,
      selfHostedModel: "drifty-preview-reasoning",
    })).toMatchObject({
      selfHostedBaseUrl: DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
      selfHostedModel: "",
    });
  });
});
