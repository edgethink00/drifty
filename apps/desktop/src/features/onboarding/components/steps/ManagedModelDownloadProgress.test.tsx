// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import type { ManagedLocalAiStatus } from "../../../settings/managedLocalAiClient";
import { ManagedModelDownloadProgress } from "./ManagedModelDownloadProgress";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function status(overrides: Partial<ManagedLocalAiStatus> = {}): ManagedLocalAiStatus {
  return {
    state: "installing",
    selectedModelId: "drifty-qwen3-5-4b-default",
    installedModels: [],
    baseUrl: null,
    model: null,
    message: "Downloading managed local model...",
    artifactDir: null,
    progress: { percent: 44, downloadedBytes: 1_200_000_000, totalBytes: 2_740_937_888 },
    errorKind: null,
    memoryUsageBytes: null,
    requiredResourceBytes: null,
    availableResourceBytes: null,
    ...overrides,
  } as ManagedLocalAiStatus;
}

function fillWidth(): string {
  const fill = document.querySelector(".dc-onb-download__fill") as HTMLElement | null;
  return fill?.style.width ?? "";
}

describe("ManagedModelDownloadProgress", () => {
  it("shows how much of the model has actually arrived, not just a percentage", () => {
    render(<ManagedModelDownloadProgress status={status()} />);

    const bar = screen.getByRole("progressbar", { name: "Downloading..." });
    expect(bar.getAttribute("aria-valuenow")).toBe("44");
    expect(fillWidth()).toBe("44%");
    expect(screen.getByText("44%")).toBeTruthy();
    expect(screen.getByText("1.2/2.7 GB")).toBeTruthy();
  });

  it("moves without claiming a position before the first byte is reported", () => {
    render(<ManagedModelDownloadProgress status={status({ progress: null })} />);

    const bar = screen.getByRole("progressbar", { name: "Downloading..." });
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    expect(document.querySelector(".dc-onb-download__fill--indeterminate")).toBeTruthy();
    // No numbers are invented while none are known.
    expect(document.querySelector(".dc-onb-download__meta")).toBeNull();
  });

  it("stays out of the way when no download is running", () => {
    const { container } = render(<ManagedModelDownloadProgress status={status({ state: "running", progress: null })} />);
    expect(container.firstChild).toBeNull();

    cleanup();
    const empty = render(<ManagedModelDownloadProgress status={null} />);
    expect(empty.container.firstChild).toBeNull();
  });

  it("adds a coarse remaining-time read once the transfer rate is measurable", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ManagedModelDownloadProgress status={status({ progress: { percent: 10, downloadedBytes: 300_000_000, totalBytes: 3_000_000_000 } })} />,
    );
    expect(screen.queryByText(/left$/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(
      <ManagedModelDownloadProgress status={status({ progress: { percent: 20, downloadedBytes: 600_000_000, totalBytes: 3_000_000_000 } })} />,
    );
    act(() => {
      vi.advanceTimersByTime(1_200);
    });

    expect(screen.getByText("about 1 min left")).toBeTruthy();
  });

  it("uses the same Korean wording as every other wait in the app", () => {
    render(
      <LocalizationTestProvider language="ko">
        <ManagedModelDownloadProgress status={status()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("progressbar", { name: "다운로드 중…" })).toBeTruthy();
    expect(screen.getByText("1.2/2.7 GB")).toBeTruthy();
  });
});
