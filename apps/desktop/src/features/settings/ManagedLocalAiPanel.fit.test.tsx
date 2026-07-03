// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ManagedLocalAiPanel } from "./ManagedLocalAiPanel";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import type { ManagedLocalAiModel } from "./managedLocalAiClient";

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
    id: "drifty-gemma-4-12b-local",
    tier: "gemma",
    label: "Gemma 4 12B",
    detail: "More accurate on nuanced work.",
    estimatedRuntimeMemoryBytes: 9_288_286_208,
    recommended: false,
    fit: "tight",
    fitDetail: "May be slow and heavy alongside other apps on a 16 GB Mac.",
  },
  {
    ...baseModel,
    id: "drifty-qwen3-6-27b-smart",
    tier: "smart",
    label: "Qwen 3.6 27B",
    detail: "Most accurate classification.",
    estimatedRuntimeMemoryBytes: 19_864_223_744,
    recommended: false,
    fit: "insufficient",
    fitDetail: "Needs at least 36 GB of memory — this Mac has 16 GB.",
  },
];

function renderPanel() {
  return render(
    <ManagedLocalAiPanel
      actionModelId={null}
      catalog={catalog}
      loading={false}
      localAiSetup={DEFAULT_LOCAL_AI_SETUP}
      status={null}
      onDeleteModel={vi.fn()}
      onInstallModel={vi.fn()}
    />,
  );
}

describe("ManagedLocalAiPanel hardware fit", () => {
  it("labels the machine-aware recommendation", () => {
    renderPanel();
    const card = screen.getByRole("article", { name: "Qwen 3.5 4B managed local model" });
    expect(within(card).getByText("Recommended for your Mac")).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Download/ })).toHaveProperty("disabled", false);
  });

  it("warns when a model fits but will be slow", () => {
    renderPanel();
    const card = screen.getByRole("article", { name: "Gemma 4 12B managed local model" });
    expect(within(card).getByText("May be slow on this Mac")).toBeTruthy();
    expect(within(card).getByText("May be slow and heavy alongside other apps on a 16 GB Mac.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Download/ })).toHaveProperty("disabled", false);
  });

  it("disables download for models that do not fit in memory", () => {
    renderPanel();
    const card = screen.getByRole("article", { name: "Qwen 3.6 27B managed local model" });
    expect(within(card).getByText("Not enough memory")).toBeTruthy();
    expect(within(card).getByText("Needs at least 36 GB of memory — this Mac has 16 GB.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: /Download/ })).toHaveProperty("disabled", true);
    expect(card.className).toContain("is-unsupported");
  });
});
