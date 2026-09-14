import { describe, expect, it } from "vitest";

import {
  buildAgentsDayModel,
  buildAgentsDayCellGroups,
  buildAgentsGridCells,
  buildAgentsIntensityBands,
  buildAgentsRunSegments,
  buildAgentsRunStretches,
  buildAgentsWeekModel,
  agentMinutesByRepo,
  agentsHourHistogram,
  agentsInsightNumbers,
  agentsRhythmScaleMax,
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
  it("keeps cumulative agent-hours separate from elapsed wall-clock", () => {
    const model = buildAgentsDayModel(source);
    // Turns span 600-780 merged (180) plus 900-960 (60): wall-clock 240,
    // while the cumulative sum would be 120+120+60 = 300.
    expect(model.wallClockMinutes).toBe(240);
    expect(model.cumulativeMinutes).toBe(300);
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
    expect(week.wallClockMinutes).toBe(480);
    expect(week.cumulativeMinutes).toBe(600);
    expect(week.unattendedMinutes).toBe(280);
    expect(week.commitCount).toBe(6);
    expect(week.repos[0]).toMatchObject({ repo: "drifty_mac", commitCount: 4 });
    expect(week.peakDayCumulativeMinutes).toBe(300);
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

  it("keeps repo allocation cumulative while omitting unlabelled time", () => {
    const labelledCumulative = [...agentMinutesByRepo([labelled]).values()].reduce((sum, minutes) => sum + minutes, 0);
    // Parallel turns count independently. The extra 30 minutes without a repo
    // stay in the headline total but cannot be assigned to a repo slice.
    expect(labelledCumulative).toBe(300);
    expect(buildAgentsDayModel(labelled).wallClockMinutes).toBe(270);
    expect(buildAgentsDayModel(labelled).cumulativeMinutes).toBe(330);
  });
});

describe("agentsHourHistogram", () => {
  it("counts parallel turns independently as hourly agent work", () => {
    const histogram = agentsHourHistogram([{
      ...source,
      turns: [
        [60, 120, "codex"],
        [60, 120, "claude_code"],
        [60, 120, "gemini"],
        [60, 120, "opencode"],
      ],
      commits: [],
    }]);

    expect(histogram.agentWorkMinutes[1]).toBe(240);
    expect(histogram.peakAgentWorkHour).toBe(1);
  });

  it("clips each turn to the hourly buckets it crosses", () => {
    const histogram = agentsHourHistogram([{
      ...source,
      turns: [
        [30, 90, "codex"],
        [45, 75, "claude_code"],
      ],
      commits: [],
    }]);

    expect(histogram.agentWorkMinutes.slice(0, 3)).toEqual([45, 45, 0]);
  });

  it("ignores non-finite records and clips otherwise valid work to the logical day", () => {
    const histogram = agentsHourHistogram([{
      ...source,
      turns: [
        [-30, 30, "codex"],
        [60, 120, "codex"],
        [1430, 1500, "codex"],
        [Number.NaN, 60, "codex"],
        [60, Number.POSITIVE_INFINITY, "codex"],
        [120, 60, "codex"],
      ],
      commits: [
        [90, 1, 0, 1, "valid", "drifty_mac"],
        [Number.NaN, 1, 0, 1, "nan", "drifty_mac"],
        [Number.POSITIVE_INFINITY, 1, 0, 1, "infinite", "drifty_mac"],
        [-1, 1, 0, 1, "before", "drifty_mac"],
        [1440, 1, 0, 1, "after", "drifty_mac"],
      ],
    }]);

    expect(histogram.agentWorkMinutes[0]).toBe(30);
    expect(histogram.agentWorkMinutes[1]).toBe(60);
    expect(histogram.agentWorkMinutes[23]).toBe(10);
    expect(histogram.agentWorkMinutes.reduce((sum, minutes) => sum + minutes, 0)).toBe(100);
    expect(histogram.commits.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(histogram.commits[1]).toBe(1);
  });
});

describe("agentsRhythmScaleMax", () => {
  it("keeps an empty chart legible and expands past one hour with headroom", () => {
    expect(agentsRhythmScaleMax(0)).toBe(60);
    expect(agentsRhythmScaleMax(60)).toBe(75);
    expect(agentsRhythmScaleMax(240)).toBe(270);
  });

  it("fails soft for non-finite observations", () => {
    expect(agentsRhythmScaleMax(Number.NaN)).toBe(60);
    expect(agentsRhythmScaleMax(Number.POSITIVE_INFINITY)).toBe(60);
  });

  it("stays finite, at or above every observation, and monotonic once data exists", () => {
    const observations = [0, 1, 15, 30, 31, 60, 90, 91, 240, 241, 720, 721, 1_440, 1_441, 2_880, 2_881, 10_000];
    const scaleMaxima = observations.map(agentsRhythmScaleMax);

    scaleMaxima.forEach((maximum, index) => {
      expect(Number.isFinite(maximum)).toBe(true);
      expect(maximum).toBeGreaterThanOrEqual(observations[index] ?? 0);
    });
    const positiveScaleMaxima = scaleMaxima.slice(1);
    expect(positiveScaleMaxima).toEqual([...positiveScaleMaxima].sort((a, b) => a - b));
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

  it("clips hover facts to the cell and retains each repo's actual tools", () => {
    const cells = buildAgentsGridCells({
      day: "2026-08-22",
      attention: [],
      turns: [
        [600, 640, "codex", "alpha", "model-a", 0],
        [620, 650, "claude", "beta", "model-b", 0],
        [623, 624, "gemini", "gamma", "model-c", 0],
      ],
      commits: [
        [619, 1, 0, 1, "before", "alpha"],
        [622, 1, 0, 1, "inside", "beta"],
        [624, 1, 0, 1, "edge", "gamma"],
      ],
    }, 3, ["alpha", "beta", "gamma"]);
    expect(cells.get(621)).toMatchObject({
      concurrency: 3, activeMinutes: 3, commitCount: 1,
      repos: [
        { repo: "alpha", providers: ["codex"] },
        { repo: "beta", providers: ["claude"] },
        { repo: "gamma", providers: ["gemini"] },
      ],
      models: ["model-a", "model-b", "model-c"],
    });
    expect(cells.get(642)).toMatchObject({
      concurrency: 1, activeMinutes: 3, commitCount: 0,
      repos: [{ repo: "beta", providers: ["claude"] }], models: ["model-b"],
    });
    expect(cells.get(624)?.models).toEqual(["model-a", "model-b"]);
    expect(cells.get(624)?.commitCount).toBe(1);
  });

  it.each([3, 4, 5, 6])("measures serial activity and gaps inside a %i-minute cell", (interval) => {
    const cells = buildAgentsGridCells({
      day: "2026-08-22", attention: [], commits: [],
      turns: [
        [0, 0.5, "codex", "alpha", "a", 0],
        [1, 2, "claude", "   ", "b", 0],
        [interval, interval + 1, "gemini", "later", "later", 0],
      ],
    }, interval);
    expect(cells.get(0)).toMatchObject({
      concurrency: 1, activeMinutes: 1.5, topRepo: null,
      repos: [{ repo: null, providers: ["claude"] }, { repo: "alpha", providers: ["codex"] }],
      models: ["a", "b"],
    });
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

describe("buildAgentsRunSegments", () => {
  const bands = buildAgentsIntensityBands(2);
  const source: AgentsDaySource = {
    day: "2026-08-22",
    attention: [[0, 15]],
    turns: [
      [0, 15, "codex", "alpha"],
      [15, 30, "codex", "alpha"],
      [15, 30, "claude", "alpha"],
      [30, 45, "codex", "beta"],
      [30, 45, "claude", "beta"],
      [45, 60, "codex", "beta"],
    ],
    commits: [],
  };

  it("breaks one run where the concurrency band or the repository changes", () => {
    const [run] = buildAgentsRunStretches(source, ["alpha", "beta"], undefined, bands);
    const cells = buildAgentsGridCells(source, 15, ["alpha", "beta"]);
    expect(run).toMatchObject({ start: 0, end: 60 });
    expect(buildAgentsRunSegments(run!, cells, 15, bands).map((segment) => ({
      start: segment.start,
      end: segment.end,
      peak: segment.peakConcurrency,
      repo: segment.topRepo,
      band: segment.intensityBand.label,
    }))).toEqual([
      { start: 0, end: 15, peak: 1, repo: "alpha", band: "×1" },
      { start: 15, end: 30, peak: 2, repo: "alpha", band: "×2" },
      { start: 30, end: 45, peak: 2, repo: "beta", band: "×2" },
      { start: 45, end: 60, peak: 1, repo: "beta", band: "×1" },
    ]);
  });

  it("carries attention and active minutes from the cells it covers", () => {
    const [run] = buildAgentsRunStretches(source, ["alpha", "beta"], undefined, bands);
    const segments = buildAgentsRunSegments(run!, buildAgentsGridCells(source, 15, []), 15, bands);
    expect(segments[0]).toMatchObject({ activeMinutes: 15, attended: true });
    expect(segments[3]).toMatchObject({ activeMinutes: 15, attended: false });
  });

  it("leaves a gap where a cell has no agent time and clips to the run", () => {
    const sparse: AgentsDaySource = {
      day: "2026-08-22",
      attention: [],
      turns: [[0, 15, "codex", "alpha"], [45, 60, "codex", "alpha"]],
      commits: [],
    };
    const cells = buildAgentsGridCells(sparse, 15, ["alpha"]);
    const run = {
      start: 7,
      end: 52,
      activeMinutes: 15,
      peakConcurrency: 1,
      topRepo: "alpha",
      providers: ["codex"],
      models: [],
      commitCount: 0,
      intensityBand: bands[0]!,
    };
    expect(buildAgentsRunSegments(run, cells, 15, bands).map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 7, end: 15 },
      { start: 45, end: 52 },
    ]);
  });
});

describe("buildAgentsDayCellGroups", () => {
  it("merges adjacent cells with identical tools, repos, concurrency, and models into one group", () => {
    const sample: AgentsDaySource = {
      day: "2026-08-28",
      attention: [],
      turns: [
        [60, 90, "codex", "alpha", "model-a"],
      ],
      commits: [
        [70, 1, 0, 1, "sha1", "alpha"],
        [85, 2, 0, 1, "sha2", "alpha"],
      ],
    };
    const cells = buildAgentsGridCells(sample, 15, ["alpha"]);
    const groups = buildAgentsDayCellGroups(cells, 15);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      startMinute: 60,
      endMinute: 90,
      concurrency: 1,
      topRepo: "alpha",
      activeMinutes: 30,
      models: ["model-a"],
      commitCount: 2,
    });
    expect(groups[0]?.cells).toHaveLength(2);
  });

  it("splits groups when models differ (conservative grouping rule)", () => {
    const sample: AgentsDaySource = {
      day: "2026-08-28",
      attention: [],
      turns: [
        [60, 75, "codex", "alpha", "model-a"],
        [75, 90, "codex", "alpha", "model-b"],
      ],
      commits: [],
    };
    const cells = buildAgentsGridCells(sample, 15, ["alpha"]);
    const groups = buildAgentsDayCellGroups(cells, 15);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.models).toEqual(["model-a"]);
    expect(groups[1]?.models).toEqual(["model-b"]);
    expect(groups[0]?.endMinute).toBe(75);
    expect(groups[1]?.startMinute).toBe(75);
  });

  it("splits groups when concurrency changes", () => {
    const sample: AgentsDaySource = {
      day: "2026-08-28",
      attention: [],
      turns: [
        [60, 90, "codex", "alpha", "model-a"],
        [75, 90, "claude", "beta", "model-b"],
      ],
      commits: [],
    };
    const cells = buildAgentsGridCells(sample, 15, ["alpha", "beta"]);
    const groups = buildAgentsDayCellGroups(cells, 15);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.concurrency).toBe(1);
    expect(groups[1]?.concurrency).toBe(2);
    expect(groups[0]?.startMinute).toBe(60);
    expect(groups[0]?.endMinute).toBe(75);
    expect(groups[1]?.startMinute).toBe(75);
    expect(groups[1]?.endMinute).toBe(90);
  });

  it("splits groups across gaps between non-adjacent cells", () => {
    const sample: AgentsDaySource = {
      day: "2026-08-28",
      attention: [],
      turns: [
        [0, 15, "codex", "alpha", "model-a"],
        [30, 45, "codex", "alpha", "model-a"],
      ],
      commits: [],
    };
    const cells = buildAgentsGridCells(sample, 15, ["alpha"]);
    const groups = buildAgentsDayCellGroups(cells, 15);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.startMinute).toBe(0);
    expect(groups[0]?.endMinute).toBe(15);
    expect(groups[1]?.startMinute).toBe(30);
    expect(groups[1]?.endMinute).toBe(45);
  });
});
