// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareCardModal } from "./ShareCardModal";
import type { CommunityFocusPercentileModels } from "../companion/communityFocusPercentile";
import type { ShareCardLiveRanks } from "./shareCardUnifiedSvg";
import type { ShareCardLiveRanksState } from "./useShareCardLiveRanks";

const exportMocks = vi.hoisted(() => ({
  copyShareCardPng: vi.fn(() => Promise.resolve()),
  openShareComposer: vi.fn((_url: string) => Promise.resolve()),
  saveShareCardWithDialog: vi.fn((_svg: string, _width: number, _height: number, _fileName: string): Promise<{ path: string | null; cancelled: boolean }> => Promise.resolve({ path: "/Users/test/Downloads/drifty.png", cancelled: false })),
  shareCardSvgDataUrl: vi.fn(() => "data:image/svg+xml,test"),
}));

const modelMocks = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve<CommunityFocusPercentileModels>({ daily: null, weekly: null })),
}));
vi.mock("../companion/communityFocusPercentileModelService", () => ({
  loadCommunityFocusPercentileModels: modelMocks.load,
}));

const rankMocks = vi.hoisted(() => ({
  state: {
    daily: {
      availability: "ready" as const,
      rank: {
        rank: 11,
        participantCount: 2_858,
        topPercent: 0.4,
        windowStartDay: "2026-08-06",
        windowEndDay: "2026-08-06",
      },
    },
    weekly: { availability: "not_joined" as const, rank: null },
  } as ShareCardLiveRanksState,
  liveRanks: {
    daily: {
      rank: 11,
      participantCount: 2_858,
      topPercent: 0.4,
      windowStartDay: "2026-08-06",
      windowEndDay: "2026-08-06",
    },
    weekly: null,
  } as ShareCardLiveRanks,
  refresh: vi.fn(() => Promise.resolve()),
}));

vi.mock("./shareCardExport", () => exportMocks);
vi.mock("./useShareCardLiveRanks", () => ({
  useShareCardLiveRanks: () => rankMocks,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  modelMocks.load.mockReset().mockImplementation(() => Promise.resolve({ daily: null, weekly: null }));
  rankMocks.state = {
    daily: {
      availability: "ready",
      rank: {
        rank: 11,
        participantCount: 2_858,
        topPercent: 0.4,
        windowStartDay: "2026-08-06",
        windowEndDay: "2026-08-06",
      },
    },
    weekly: { availability: "not_joined", rank: null },
  };
  rankMocks.liveRanks = {
    daily: {
      rank: 11,
      participantCount: 2_858,
      topPercent: 0.4,
      windowStartDay: "2026-08-06",
      windowEndDay: "2026-08-06",
    },
    weekly: null,
  };
});

const card = {
  kind: "day" as const,
  data: {
    day: "2026-08-06",
    weekdayLabel: "Thursday",
    dateLabel: "Aug 6",
    totalSeconds: 21_600,
    focusSeconds: 18_000,
    isCurrentPeriod: true,
    focusPercent: 83,
    productivitySlices: [{ key: "focus" as const, seconds: 18_000, ratio: 0.83 }],
    deltaSeconds: null,
    slices: [],
    hours: [],
    longestFocusSeconds: 7_200,
    peakFocusLabel: "10–12h",
  },
};

function renderModal() {
  render(<ShareCardModal card={card} defaultTheme="light" onClose={vi.fn()} />);
}

describe("ShareCardModal feedback", () => {
  it("shows a copied-image toast outside the modal", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));

    const toast = await screen.findByRole("status");
    expect(toast.classList.contains("share-card-toast")).toBe(true);
    expect(toast.textContent).toContain("Image copied");
    expect(toast.textContent).toContain("Ready to paste with ⌘V.");
    expect(screen.getByRole("dialog").contains(toast)).toBe(false);
  });

  it("opens the social composer with the image-paste instruction in its draft", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));

    await waitFor(() => expect(exportMocks.openShareComposer).toHaveBeenCalledTimes(1));
    const composerUrl = new URL(exportMocks.openShareComposer.mock.calls[0]?.[0]);
    expect(composerUrl.searchParams.get("text")).toContain("Image copied — paste it here with ⌘V.");
    expect(screen.getByRole("status").textContent).toContain("LinkedIn composer opened.");
  });

  it("keeps the card quiet when the native save panel is cancelled", async () => {
    exportMocks.saveShareCardWithDialog.mockResolvedValueOnce({ path: null, cancelled: true });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Save PNG" }));

    await waitFor(() => expect(exportMocks.saveShareCardWithDialog).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("locks only the precise place-rank card when the user has not joined", async () => {
    rankMocks.state = {
      daily: { availability: "not_joined", rank: null },
      weekly: { availability: "not_joined", rank: null },
    };
    rankMocks.liveRanks = { daily: null, weekly: null };
    render(
      <ShareCardModal
        card={card}
        defaultTheme="light"
        onJoinLeaderboard={() => Promise.resolve()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByText("Loading comparison data…")).toBeNull());
    expect(screen.queryByText("Join the leaderboard to unlock your live rank cards.")).toBeNull();
    expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: "Place Rank" }));

    expect(screen.getByText("Join the leaderboard to unlock your live rank cards.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Focus time" }));

    await waitFor(() => expect(screen.queryByText("Loading comparison data…")).toBeNull());
    expect(screen.queryByText("Join the leaderboard to unlock your live rank cards.")).toBeNull();
    expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects a live daily rank whose start day does not match the card", async () => {
    const mismatchedRank = {
        rank: 11,
        participantCount: 2_858,
        topPercent: 0.4,
        windowStartDay: "2026-08-01",
        windowEndDay: card.data.day,
    };
    rankMocks.state = {
      daily: {
        availability: "ready",
        rank: mismatchedRank,
      },
      weekly: { availability: "not_joined", rank: null },
    };
    rankMocks.liveRanks = { daily: mismatchedRank, weekly: null };
    render(
      <ShareCardModal
        card={card}
        defaultTheme="light"
        onJoinLeaderboard={() => Promise.resolve()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Place Rank" }));

    await waitFor(() => expect(screen.queryByText("Loading comparison data…")).toBeNull());
    expect(screen.getByText("Live rank cards are available for the current leaderboard window.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the selected story stable while an image export is in progress", async () => {
    let finishCopy: (() => void) | undefined;
    exportMocks.copyShareCardPng.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishCopy = resolve;
    }));
    renderModal();

    const copyButton = screen.getByRole("button", { name: "Copy image" });
    fireEvent.click(copyButton);

    expect((screen.getByRole("button", { name: "Previous share card" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Focus time" }) as HTMLButtonElement).disabled).toBe(true);
    expect(copyButton.getAttribute("aria-busy")).toBe("true");

    finishCopy?.();
    await waitFor(() => expect(copyButton.getAttribute("aria-busy")).toBe("false"));
  });
});


describe("community comparison export", () => {
  it("uses the loaded community estimate without leaderboard membership", async () => {
    rankMocks.state = {
      daily: { availability: "not_joined", rank: null },
      weekly: { availability: "not_joined", rank: null },
    };
    modelMocks.load.mockResolvedValueOnce({ daily: {
      version: 1, source: "leaderboard", period: "daily", sampleSize: 100, participantCount: 100,
      logMeanMinutes: Math.log(300), logStandardDeviationMinutes: 0.5,
      generatedAt: new Date().toISOString(),
    }, weekly: null });
    renderModal();
    await waitFor(() => expect(exportMocks.shareCardSvgDataUrl).toHaveBeenLastCalledWith(
      expect.stringContaining("From 100 leaderboard participants"),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Save PNG" }));
    await waitFor(() => expect(exportMocks.saveShareCardWithDialog).toHaveBeenCalledTimes(1));
    expect(exportMocks.saveShareCardWithDialog.mock.calls[0]?.[0]).toContain(">Top 50%<");
  });

  it("keeps export available without inventing a rank while statistics are unavailable", async () => {
    rankMocks.state = {
      daily: { availability: "not_joined", rank: null },
      weekly: { availability: "not_joined", rank: null },
    };
    modelMocks.load.mockRejectedValueOnce(new Error("offline"));
    renderModal();
    await waitFor(() => expect(screen.queryByText("Loading comparison data…")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save PNG" }));
    await waitFor(() => expect(exportMocks.saveShareCardWithDialog).toHaveBeenCalledTimes(1));
    const svg = exportMocks.saveShareCardWithDialog.mock.calls[0]?.[0];
    expect(svg).toContain("Focus time");
    expect(svg).not.toContain("Estimated focus percentile");
  });
});


it("waits for comparison data before exporting a percentile, while focus-only export stays available", async () => {
  rankMocks.state = {
    daily: { availability: "not_joined", rank: null },
    weekly: { availability: "not_joined", rank: null },
  };
  let resolveModels!: (models: CommunityFocusPercentileModels) => void;
  modelMocks.load.mockReturnValueOnce(new Promise((resolve) => { resolveModels = resolve; }));
  renderModal();
  expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Focus time" }));
  expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "Curve Card" }));
  expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { resolveModels({ daily: null, weekly: null }); });
  expect((screen.getByRole("button", { name: "Copy image" }) as HTMLButtonElement).disabled).toBe(false);
});
