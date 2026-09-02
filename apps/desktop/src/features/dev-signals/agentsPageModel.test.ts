import { describe, expect, it } from "vitest";

import {
  buildAgentsDayModel,
  buildAgentsGridCells,
  buildAgentsIntensityBands,
  buildAgentsRunStretches,
  buildAgentsWeekModel,
  agentMinutesByRepo,
  agentsInsightNumbers,
  gridRepoLegend,
  lockAgentsIntensityPeak,
  visibleAgentsIntensityBands,
  weekdayLabelFor,
  type AgentsDaySource,
} from "./agentsPageModel";

const source: AgentsDaySource = {
  day: "2026-08-22",
  attention: [[600, 660], [650, 700]],
  turns: [
    [600, 720, "codex"],
    [660, 780, "codex"],
    [900, 960, "claude"],
  ],
  commits: [
    [610, 100, 20, 3, "aaa111", "drifty_mac"],
    [700, 50, 5, 1, "bbb222", "drifty_mac"],
    [910, 10, 2, 1, "ccc333", "agent-cli"],
  ],
};

describe("buildAgentsDayModel", () => {
  it("merges overlapping turns into wall-clock, never the cumulative sum", () => {
    const model = buildAgentsDayModel(source);
    // Turns span 600-780 merged (180) plus 900-960 (60): wall-clock 240,
    // while the cumulative sum would be 120+120+60 = 300.
    expect(model.agentMinutes).toBe(240);
    // The model rounds to one decimal for display: 300/240 = 1.25 → 1.3.
    expect(model.parallelFactor).toBe(1.3);
    expect(model.concurrencyPeak).toBe(2);
  });

  it("reports unattended time as agent minutes with no attention overlap", () => {
    const model = buildAgentsDayModel(source);
    // Attention merged 600-700; overlap with agent spans is 100.
    expect(model.attentionMinutes).toBe(100);
    expect(model.unattendedMinutes).toBe(240 - 100);
  });

  it("groups commits by repository sorted by count", () => {
    const model = buildAgentsDayModel(source);
    expect(model.repos.map((repo) => repo.repo)).toEqual(["drifty_mac", "agent-cli"]);
    expect(model.repos[0]).toMatchObject({ commitCount: 2, insertions: 150, deletions: 25, firstCommitMin: 610, lastCommitMin: 700 });
  });

  it("collects distinct providers", () => {
    expect(buildAgentsDayModel(source).providers).toEqual(["claude", "codex"]);
  });

  it("measures the physical midnight-to-6am window after rotating the logical day", () => {
    const boundarySource: AgentsDaySource = {
      day: "2026-08-22",
      attention: [],
      turns: [
        [60, 120, "codex"],
        [360, 420, "codex"],
        [1_260, 1_320, "codex"],
      ],
      commits: [],
    };

    const numbers = agentsInsightNumbers(boundarySource, buildAgentsDayModel(boundarySource), 4 * 60);
    expect(numbers.nightSharePercent).toBeCloseTo(200 / 3);
  });
});

describe("buildAgentsWeekModel", () => {
  it("sums days without re-merging across day boundaries", () => {
    const dayA = buildAgentsDayModel(source);
    const dayB = buildAgentsDayModel({ ...source, day: "2026-08-21" });
    const week = buildAgentsWeekModel([dayB, dayA]);
    expect(week.agentMinutes).toBe(480);
    expect(week.commitCount).toBe(6);
    expect(week.repos[0]).toMatchObject({ repo: "drifty_mac", commitCount: 4 });
    expect(week.peakDayAgentMinutes).toBe(240);
    expect(week.days.map((day) => day.weekdayLabel)).toEqual(["Fri", "Sat"]);
  });
});

describe("weekdayLabelFor", () => {
  it("labels a calendar date in local time", () => {
    expect(weekdayLabelFor("2026-08-22")).toBe("Sat");
    expect(weekdayLabelFor("")).toBe("");
  });
});

describe("agentMinutesByRepo", () => {
  // Turns carrying a repo label; the unlabelled one must be skipped entirely.
  const labelled: AgentsDaySource = {
    ...source,
    turns: [
      [600, 720, "codex", "drifty_mac"],
      [660, 780, "codex", "drifty_mac"],
      [900, 960, "claude", "agent-cli"],
      [960, 990, "claude", ""],
    ],
  };

  it("sums turn minutes per repo and skips unlabelled turns", () => {
    const byRepo = agentMinutesByRepo([labelled]);
    expect(byRepo.get("drifty_mac")).toBe(240);
    expect(byRepo.get("agent-cli")).toBe(60);
    expect(byRepo.has("")).toBe(false);
  });

  it("is cumulative, so the breakdown charts must rescale it to wall-clock", () => {
    const cumulative = [...agentMinutesByRepo([labelled]).values()].reduce((sum, minutes) => sum + minutes, 0);
    // Parallel turns on one repo are counted twice here; wall-clock merges them.
    expect(cumulative).toBe(300);
    expect(buildAgentsDayModel(labelled).agentMinutes).toBe(270);
  });
});

describe("buildAgentsGridCells", () => {
  const gridSource: AgentsDaySource = {
    day: "2026-08-22",
    attention: [[600, 615]],
    turns: [
      [600, 630, "codex", "drifty_mac"],
      [600, 630, "codex", "drifty_mac"],
      [610, 620, "codex", "agent-cli"],
      // Serial turns in one cell must not stack: 700-703 then 704-707.
      [700, 703, "codex", "app"],
      [704, 707, "codex", "app"],
    ],
    commits: [[612, 10, 2, 1, "aaa111", "drifty_mac"]],
  };

  it("takes peak concurrency inside the cell, not turn coverage", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    // 610-615 has both 600-630 turns plus the 610-620 turn running.
    expect(cells.get(600)?.concurrency).toBe(3);
    expect(cells.get(615)?.concurrency).toBe(3);
    // 700-703 and 704-705 are serial inside the 690-705 cell: peak stays 1.
    expect(cells.get(690)?.concurrency).toBe(1);
  });

  it("assigns the repo with most turn-minutes and marks commits and attention", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    expect(cells.get(600)?.topRepo).toBe("drifty_mac");
    expect(cells.get(600)?.commitCount).toBe(1);
    expect(cells.get(600)?.attended).toBe(true);
    expect(cells.get(615)?.attended).toBe(false);
  });

  it("keeps Project mode unlabelled when unlabelled time dominates a cell", () => {
    const cells = buildAgentsGridCells({
      ...gridSource,
      turns: [
        [600, 615, "codex", "   "],
        [600, 601, "claude", "drifty_mac"],
      ],
    }, 15);
    expect(cells.get(600)?.topRepo).toBeNull();
  });

  it("uses the shared repo ranking to break equal Project-mode durations", () => {
    const cells = buildAgentsGridCells({
      ...gridSource,
      turns: [
        [600, 615, "codex", "alpha"],
        [600, 615, "claude", "beta"],
      ],
    }, 15, ["beta", "alpha"]);
    expect(cells.get(600)?.topRepo).toBe("beta");
  });

  it("omits cells without agent activity or commits", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    expect(cells.has(645)).toBe(false);
  });

  it("does not turn a commit-only bucket into fake agent activity", () => {
    const cells = buildAgentsGridCells({
      ...gridSource,
      turns: [],
      commits: [[612, 10, 2, 1, "aaa111", "drifty_mac"]],
    }, 15);
    expect(cells.size).toBe(0);
  });

  it("orders the repo legend by cell dominance", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    expect(gridRepoLegend(cells)[0]).toBe("drifty_mac");
  });
});

describe("agent intensity bands", () => {
  it("keeps ×1 alone and grows later slots toward the personal peak", () => {
    expect(buildAgentsIntensityBands(4).map((band) => band.label)).toEqual(["×1", "×2", "×3", "×4"]);
    expect(buildAgentsIntensityBands(9).map((band) => band.label)).toEqual([
      "×1",
      "×2",
      "×3",
      "×4",
      "×5–6",
      "×7–9",
    ]);
    expect(buildAgentsIntensityBands(12).map((band) => band.label)).toEqual([
      "×1",
      "×2",
      "×3",
      "×4–5",
      "×6–8",
      "×9–12",
    ]);
    expect(buildAgentsIntensityBands(25).map((band) => band.label)).toEqual([
      "×1",
      "×2–3",
      "×4–5",
      "×6–9",
      "×10–15",
      "×16–25",
    ]);
    expect(buildAgentsIntensityBands(50).map((band) => band.label)).toEqual([
      "×1",
      "×2–4",
      "×5–8",
      "×9–16",
      "×17–29",
      "×30–50",
    ]);
  });

  it("keeps the personal legend even when the visible day is quieter", () => {
    const bands = buildAgentsIntensityBands(9);
    expect(visibleAgentsIntensityBands(0, bands)).toEqual([]);
    expect(visibleAgentsIntensityBands(1, bands).map((band) => band.label)).toEqual([
      "×1",
      "×2",
      "×3",
      "×4",
      "×5–6",
      "×7–9",
    ]);
  });

  it("opens the last slot only when live concurrency outruns the locked peak", () => {
    expect(buildAgentsIntensityBands(9, { overflow: true }).map((band) => band.label)).toEqual([
      "×1",
      "×2",
      "×3",
      "×4",
      "×5–6",
      "×7+",
    ]);
  });

  it("raises the locked peak immediately and shrinks only across a later day", () => {
    expect(lockAgentsIntensityPeak({
      previousPeak: 9,
      observedPeak: 12,
      previousLockedOnDay: "2026-08-31",
      todayDay: "2026-08-31",
    })).toEqual({ peak: 12, lockedOnDay: "2026-08-31" });
    expect(lockAgentsIntensityPeak({
      previousPeak: 12,
      observedPeak: 8,
      previousLockedOnDay: "2026-08-31",
      todayDay: "2026-08-31",
    })).toEqual({ peak: 12, lockedOnDay: "2026-08-31" });
    expect(lockAgentsIntensityPeak({
      previousPeak: 12,
      observedPeak: 9,
      previousLockedOnDay: "2026-08-31",
      todayDay: "2026-09-01",
    })).toEqual({ peak: 12, lockedOnDay: "2026-09-01" });
    expect(lockAgentsIntensityPeak({
      previousPeak: 12,
      observedPeak: 8,
      previousLockedOnDay: "2026-08-31",
      todayDay: "2026-09-01",
    })).toEqual({ peak: 8, lockedOnDay: "2026-09-01" });
  });
});

describe("buildAgentsRunStretches", () => {
  const segmentedSource: AgentsDaySource = {
    day: "2026-08-22",
    attention: [],
    turns: [
      [60, 120, "codex", "alpha"],
      [70, 100, "claude", "alpha"],
      [90, 110, "gemini", "beta"],
      [90, 110, "opencode", "beta"],
      [130, 140, "codex", "alpha"],
    ],
    commits: [],
  };

  it("keeps run boundaries stable across repo and concurrency changes", () => {
    const stretches = buildAgentsRunStretches(segmentedSource, ["beta", "alpha"]);
    expect(stretches.map(({ start, end, peakConcurrency, topRepo, intensityBand }) => ({
      start,
      end,
      peakConcurrency,
      topRepo,
      band: intensityBand.label,
    }))).toEqual([
      { start: 60, end: 120, peakConcurrency: 4, topRepo: "alpha", band: "×2–4" },
      { start: 130, end: 140, peakConcurrency: 1, topRepo: "alpha", band: "×1" },
    ]);
    expect(stretches[0]?.providers).toEqual(["claude", "codex", "gemini", "opencode"]);
  });

  it("merges message-shaped turns across the fixed small-gap threshold", () => {
    const stretches = buildAgentsRunStretches({
      ...segmentedSource,
      turns: [
        [60, 62, "codex", "alpha", "gpt-5", 0],
        [67, 70, "codex", "alpha", "gpt-5", 0],
        [76, 80, "claude", "beta", "claude-opus", 0],
      ],
      commits: [[68, 1, 0, 1, "abc", "alpha"]],
    });
    expect(stretches).toMatchObject([
      { start: 60, end: 70, activeMinutes: 5, models: ["gpt-5"], commitCount: 1 },
      { start: 76, end: 80, activeMinutes: 4, models: ["claude-opus"], commitCount: 0 },
    ]);
  });

  it("retains an exact peak across 50 concurrent turns for hover details", () => {
    const highConcurrencySource: AgentsDaySource = {
      day: "2026-08-22",
      attention: [],
      turns: Array.from({ length: 50 }, (_, index) => [200, 210, `agent-${index}`, "alpha"] as const),
      commits: [],
    };
    expect(buildAgentsRunStretches(highConcurrencySource)).toMatchObject([
      { start: 200, end: 210, peakConcurrency: 50, intensityBand: { label: "×30–50" } },
    ]);
    expect(buildAgentsRunStretches(
      highConcurrencySource,
      [],
      5,
      buildAgentsIntensityBands(9),
    )).toMatchObject([
      { start: 200, end: 210, peakConcurrency: 50, intensityBand: { label: "×7–9" } },
    ]);
  });

  it("does not mistake serial turns inside one bucket for concurrent turns", () => {
    const serialSource: AgentsDaySource = {
      day: "2026-08-22",
      attention: [],
      turns: [
        [200, 202, "codex", "alpha"],
        [203, 205, "claude", "alpha"],
      ],
      commits: [],
    };
    expect(buildAgentsRunStretches(serialSource)).toMatchObject([
      { start: 200, end: 205, activeMinutes: 4, peakConcurrency: 1, intensityBand: { label: "×1" } },
    ]);
  });

  it("normalizes whitespace-only repos and lets unlabelled time dominate Project mode", () => {
    const mostlyUnlabelledSource: AgentsDaySource = {
      day: "2026-08-22",
      attention: [],
      turns: [
        [200, 205, "codex", "   "],
        [200, 201, "claude", "alpha"],
      ],
      commits: [],
    };

    expect(buildAgentsRunStretches(mostlyUnlabelledSource, ["alpha"])).toMatchObject([
      { start: 200, end: 205, topRepo: null },
    ]);
  });
});
