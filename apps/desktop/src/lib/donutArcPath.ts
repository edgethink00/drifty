export type DonutArcSegment<TEntry> = {
  readonly entry: TEntry;
  readonly pathData: string;
};

const FULL_TURN_RATIO = 1;
const HALF_TURN_RATIO = 0.5;
const DEGREES_PER_TURN = 360;

function pointOnCircle(centerX: number, centerY: number, radius: number, ratio: number): { readonly x: number; readonly y: number } {
  const radians = ratio * DEGREES_PER_TURN * (Math.PI / 180);
  return {
    x: centerX + Math.cos(radians) * radius,
    y: centerY + Math.sin(radians) * radius,
  };
}

export function donutArcPath(centerX: number, centerY: number, radius: number, startRatio: number, endRatio: number): string {
  const arcRatio = Math.max(0, endRatio - startRatio);
  if (arcRatio >= FULL_TURN_RATIO) {
    return `M ${centerX + radius} ${centerY} A ${radius} ${radius} 0 1 1 ${centerX - radius} ${centerY} A ${radius} ${radius} 0 1 1 ${centerX + radius} ${centerY}`;
  }

  const start = pointOnCircle(centerX, centerY, radius, startRatio);
  const end = pointOnCircle(centerX, centerY, radius, endRatio);
  const largeArcFlag = arcRatio > HALF_TURN_RATIO ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

export function buildDonutArcSegments<TEntry>(
  entries: readonly TEntry[],
  getRatio: (entry: TEntry) => number,
  centerX: number,
  centerY: number,
  radius: number,
  gapRatio = 0,
): readonly DonutArcSegment<TEntry>[] {
  let cursor = 0;
  return entries.map((entry) => {
    const ratio = Math.max(0, getRatio(entry));
    const visibleRatio = Math.max(0, ratio - gapRatio);
    const pathData = donutArcPath(centerX, centerY, radius, cursor, cursor + visibleRatio);
    cursor += ratio;
    return { entry, pathData };
  });
}
