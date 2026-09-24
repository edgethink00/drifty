// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "../settings/localAiSetup";
import type { OnboardingStep } from "./onboardingFlow";
import { useOnboardingConnectionFlow } from "./useOnboardingConnectionFlow";

const testLocalAiConnection = vi.hoisted(() => vi.fn());

vi.mock("../settings/aiConnectionTest", () => ({ testLocalAiConnection }));
vi.mock("../settings/useManagedLocalAiSetup", () => ({
  useManagedLocalAiSetup: () => ({ catalog: [], loading: false, actionModelId: null, status: null, installModel: vi.fn() }),
}));

afterEach(() => {
  testLocalAiConnection.mockReset();
});

function renderConnectionFlow() {
  return renderHook(({ step }: { step: OnboardingStep }) => {
    const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(DEFAULT_LOCAL_AI_SETUP);
    const flow = useOnboardingConnectionFlow({
      initialSetupChoice: "custom_endpoint",
      localAiSetup,
      onLocalAiSetupChange: setLocalAiSetup,
      step,
    });
    return { flow, localAiSetup };
  }, { initialProps: { step: "connect_server" as OnboardingStep } });
}

describe("onboarding custom endpoint API key", () => {
  it("sends the key with the connection test and applies it to the AI setup after success", async () => {
    testLocalAiConnection.mockResolvedValue({ kind: "success", message: "ok" });
    const { result, rerender } = renderConnectionFlow();

    act(() => {
      result.current.flow.handleCustomEndpointDraftChange({ baseUrl: "https://llm.example.com/v1", model: "qwen3" });
      result.current.flow.handleCustomEndpointApiKeyChange("  sk-secret-123  ");
    });
    rerender({ step: "test_connection" });

    await waitFor(() => expect(result.current.flow.connectionPhase).toBe("success"));
    expect(testLocalAiConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: "self_hosted",
      selfHostedBaseUrl: "https://llm.example.com/v1",
      selfHostedApiKey: "sk-secret-123",
      selfHostedModel: "qwen3",
    }));
    expect(result.current.localAiSetup).toMatchObject({
      provider: "self_hosted",
      selfHostedApiKey: "sk-secret-123",
    });
    // The draft is what onboarding progress persists, so it must never carry the key.
    expect(JSON.stringify(result.current.flow.customEndpointDraft)).not.toContain("sk-secret");
  });

  it("leaves the key empty for endpoints that need none", async () => {
    testLocalAiConnection.mockResolvedValue({ kind: "success", message: "ok" });
    const { result, rerender } = renderConnectionFlow();

    act(() => {
      result.current.flow.handleCustomEndpointDraftChange({ baseUrl: "http://localhost:11434/v1", model: "llama3.2:latest" });
    });
    rerender({ step: "test_connection" });

    await waitFor(() => expect(result.current.flow.connectionPhase).toBe("success"));
    expect(testLocalAiConnection).toHaveBeenCalledWith(expect.objectContaining({ selfHostedApiKey: "" }));
  });
});
