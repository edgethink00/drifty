import {
  logicalDayEndExclusiveMs,
  logicalDayIsoDateForDate,
  logicalDayStartMs,
  logicalMinuteOfDay,
  type FlowIntervalMinutes,
} from "@drifty/domain";

/**
 * An approximate span of iPhone use that the phone sent to the account: when
 * it started and ended, about how many minutes, and the name of the app group
 * it was counted for. Nothing in it names the apps themselves.
 */
export type PhoneTimeBlock = {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly minutes: number;
  readonly label: string;
};

export type PhoneFlowCell = {
  readonly minuteOfDay: number;
  readonly block: PhoneTimeBlock;
  /** Cells drawn for the same phone block share this index. */
  readonly blockIndex: number;
  /** The block's earliest cell on the chart, which carries its description. */
  readonly isFirstOfBlock: boolean;
};

/**
 * Places the day's phone blocks on the flow chart's cells. A cell shows the
 * iPhone when the phone covers at least half of it and the Mac recorded
 * nothing there; measured Mac time always keeps its cell. Phone time is only
 * a display layer: it never becomes an activity segment, so totals, focus
 * scores and everything built on segments leave it out.
 */
export function buildPhoneFlowCells(
  blocks: readonly PhoneTimeBlock[],
  day: string,
  intervalMinutes: FlowIntervalMinutes,
  startOfDayMinutes: number,
  isMacCell: (minuteOfDay: number) => boolean,
): ReadonlyMap<number, PhoneFlowCell> {
  const cells = new Map<number, { cell: Omit<PhoneFlowCell, "isFirstOfBlock">; overlapMs: number }>();
  if (blocks.length === 0) return new Map();
  const intervalMs = intervalMinutes * 60_000;
  const dayStart = logicalDayStartMs(day, startOfDayMinutes);
  const dayEnd = logicalDayEndExclusiveMs(day, startOfDayMinutes);
  const sorted = [...blocks].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));

  sorted.forEach((block, blockIndex) => {
    const start = Math.max(Date.parse(block.startedAt), dayStart);
    const end = Math.min(Date.parse(block.endedAt), dayEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    let cursor = start;
    while (cursor < end) {
      const local = new Date(cursor);
      const bucketMinute = Math.floor(local.getMinutes() / intervalMinutes) * intervalMinutes;
      const offsetInBucket = (local.getMinutes() - bucketMinute) * 60_000 + local.getSeconds() * 1000 + local.getMilliseconds();
      const bucketStart = cursor - offsetInBucket;
      const bucketEnd = bucketStart + intervalMs;
      const overlapMs = Math.min(end, bucketEnd) - Math.max(start, bucketStart);
      const minuteOfDay = local.getHours() * 60 + bucketMinute;
      if (
        overlapMs * 2 >= intervalMs
        && logicalDayIsoDateForDate(new Date(bucketStart), startOfDayMinutes) === day
        && !isMacCell(minuteOfDay)
      ) {
        const existing = cells.get(minuteOfDay);
        if (!existing || existing.overlapMs < overlapMs) {
          cells.set(minuteOfDay, { cell: { minuteOfDay, block, blockIndex }, overlapMs });
        }
      }
      cursor = bucketEnd;
    }
  });

  const firstMinuteByBlock = new Map<number, number>();
  for (const { cell } of cells.values()) {
    const logical = logicalMinuteOfDay(cell.minuteOfDay, startOfDayMinutes);
    const current = firstMinuteByBlock.get(cell.blockIndex);
    if (current === undefined || logical < logicalMinuteOfDay(current, startOfDayMinutes)) {
      firstMinuteByBlock.set(cell.blockIndex, cell.minuteOfDay);
    }
  }
  return new Map([...cells].map(([minuteOfDay, { cell }]) => [minuteOfDay, {
    ...cell,
    isFirstOfBlock: firstMinuteByBlock.get(cell.blockIndex) === minuteOfDay,
  }]));
}

/** Sample phone time for the browser preview, which has no account. */
export function previewPhoneTimeBlocks(day: string, startOfDayMinutes: number): PhoneTimeBlock[] {
  const dayStart = logicalDayStartMs(day, startOfDayMinutes);
  const at = (hour: number, minute: number) => {
    const [year, month, date] = day.split("-").map(Number);
    const time = new Date(year, month - 1, date, hour, minute).getTime();
    return new Date(time < dayStart ? time + 24 * 60 * 60_000 : time).toISOString();
  };
  return [
    { startedAt: at(7, 35), endedAt: at(8, 5), minutes: 30, label: "Distracting apps" },
    { startedAt: at(12, 40), endedAt: at(13, 5), minutes: 25, label: "Distracting apps" },
    { startedAt: at(22, 10), endedAt: at(22, 55), minutes: 45, label: "Distracting apps" },
  ];
}
