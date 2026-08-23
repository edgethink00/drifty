import { describe, expect, it } from "vitest";

import {
  buildAgentsDayModel,
  buildAgentsGridCells,
  buildAgentsWeekModel,
  agentMinutesByRepo,
  gridRepoLegend,
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

  it("omits cells without agent activity or commits", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    expect(cells.has(645)).toBe(false);
  });

  it("orders the repo legend by cell dominance", () => {
    const cells = buildAgentsGridCells(gridSource, 15);
    expect(gridRepoLegend(cells)[0]).toBe("drifty_mac");
  });
});
