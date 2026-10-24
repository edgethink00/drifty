// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ChatCreditsRow } from "./ChatCreditsRow";

afterEach(() => cleanup());

describe("Drifty Cloud credits in Settings › Account", () => {
  it("shows what is left of the period's credits and when they renew", async () => {
    const invoke = vi.fn(async () => ({ status: 200, data: {
      available: true, plan: "active", defaultModel: "sonnet",
      credits: { remaining: 742, granted: 1000, renewsAt: "2026-11-15T09:00:00.000Z" }, models: [],
    } }));
    render(<LocalizationTestProvider language="ko"><ChatCreditsRow invoke={invoke} /></LocalizationTestProvider>);
    await waitFor(() => expect(screen.getByText("742 / 1,000 남음")).toBeTruthy());
    expect(screen.getByText("11월 15일 갱신")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Drifty Cloud 크레딧" }).getAttribute("aria-valuenow")).toBe("742");
  });

  it("explains that Cloud chat comes with a trial or Pro on a free plan", async () => {
    const invoke = vi.fn(async () => ({ status: 200, data: { available: false, plan: "locked", credits: { remaining: 0, granted: 0, renewsAt: null }, models: [] } }));
    render(<LocalizationTestProvider language="en"><ChatCreditsRow invoke={invoke} /></LocalizationTestProvider>);
    await waitFor(() => expect(screen.getByText("Drifty Cloud chat comes with a trial or Pro.")).toBeTruthy());
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

