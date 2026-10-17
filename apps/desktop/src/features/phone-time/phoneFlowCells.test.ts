import { describe, expect, it } from "vitest";
import { buildPhoneFlowCells, type PhoneTimeBlock } from "./phoneFlowCells";

const local = (day: string, hour: number, minute: number) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute).toISOString();
};

function block(day: string, from: [number, number], to: [number, number], endDay = day): PhoneTimeBlock {
  return { startedAt: local(day, ...from), endedAt: local(endDay, ...to), minutes: 0, label: "SNS" };
}

describe("buildPhoneFlowCells", () => {
  it("fills the cells the phone covers at least half of, leaving the Mac's cells alone", () => {
    const macMinutes = new Set([10 * 60 + 12]);
    const cells = buildPhoneFlowCells([block("2026-10-17", [10, 2], [10, 27])], "2026-10-17", 4, 0, (minute) => macMinutes.has(minute));

    // 10:00 holds 2 of 4 minutes and 10:24 holds 3, so both count; 10:28 holds none.
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual([600, 604, 608, 616, 620, 624]);
    expect(cells.get(600)).toMatchObject({ blockIndex: 0, isFirstOfBlock: true });
    expect([...cells.values()].filter((cell) => cell.isFirstOfBlock)).toHaveLength(1);
  });

  it("skips cells under half covered", () => {
    const cells = buildPhoneFlowCells([block("2026-10-17", [9, 3], [9, 13])], "2026-10-17", 4, 0, () => false);
    // 09:00 holds 1 minute, 09:04 and 09:08 are full, 09:12 holds 1 minute.
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual([544, 548]);
  });

  it("keeps only the part of a block inside the logical day", () => {
    const acrossMidnight = block("2026-10-16", [23, 50], [0, 10], "2026-10-17");
    const cells = buildPhoneFlowCells([acrossMidnight], "2026-10-17", 4, 0, () => false);
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual([0, 4, 8]);

    // With the day starting at 04:00, 02:00 the next morning still belongs to it.
    const lateNight = block("2026-10-18", [2, 0], [2, 8]);
    const earlyMorning = block("2026-10-17", [2, 0], [2, 8]);
    const shifted = buildPhoneFlowCells([lateNight, earlyMorning], "2026-10-17", 4, 240, () => false);
    expect([...shifted.values()].map((cell) => cell.block)).toEqual([lateNight, lateNight]);
  });
});
