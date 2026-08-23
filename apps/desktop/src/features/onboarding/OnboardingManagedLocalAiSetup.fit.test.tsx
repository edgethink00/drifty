// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingManagedLocalAiSetup } from "./OnboardingManagedLocalAiSetup";
import type { ManagedLocalAiModel } from "../settings/managedLocalAiClient";

const baseModel: ManagedLocalAiModel = {
  id: "drifty-qwen3-5-4b-default",
  tier: "default",
  label: "Qwen 3.5 4B",
  detail: "Recommended local model.",
  downloadSize: "~2.8 GB",
  diskRequired: "6 GB free",
  minimumMemory: "16 GB RAM",
  estimatedRuntimeMemoryBytes: 3_758_096_384,
  recommended: true,
  fit: "good",
  fitDetail: null,
};

const catalog: readonly ManagedLocalAiModel[] = [
  baseModel,
  {
    ...baseModel,
    id: "drifty-qwen3-6-27b-smart",
    tier: "smart",
    label: "Qwen 3.6 27B",
    detail: "Most accurate classification.",
    estimatedRuntimeMemoryBytes: 19_864_223_744,
    recommended: false,
    fit: "insufficient",
    fitDetail: "Needs at least 36 GB of memory — this computer has 16 GB.",
  },
];

describe("OnboardingManagedLocalAiSetup hardware fit", () => {
  it("shows the machine-aware recommendation, RAM estimate, and blocks unsupported models", () => {
    render(
      <OnboardingManagedLocalAiSetup
        actionModelId={null}
        catalog={catalog}
        loading={false}
        status={null}
        onInstallModel={vi.fn()}
      />,
    );

    const recommendedCard = screen.getByRole("article", { name: "Qwen 3.5 4B local AI model" });
    expect(within(recommendedCard).getByText("Recommended for your computer")).toBeTruthy();
    expect(within(recommendedCard).getByText("RAM while running")).toBeTruthy();
    expect(within(recommendedCard).getByText("~3.5 GB")).toBeTruthy();
    expect(within(recommendedCard).getByRole("button", { name: "Download" })).toHaveProperty("disabled", false);

    const unsupportedCard = screen.getByRole("article", { name: "Qwen 3.6 27B local AI model" });
    expect(within(unsupportedCard).getByText("Needs at least 36 GB of memory — this computer has 16 GB.")).toBeTruthy();
    expect(within(unsupportedCard).getByRole("button", { name: "Download" })).toHaveProperty("disabled", true);
    expect(unsupportedCard.className).toContain("is-unsupported");
  });
});
