import { ACHIEVEMENT_GLYPH_PATHS } from "./AchievementGlyph";
import { dialArc, dialPoint, type AchievementArtProps } from "./achievementArt";

const RING = 40;
const SLOTS = 96;
const STATE_CLASS: Record<string, string> = { f: "adr-focus", n: "adr-neutral", d: "adr-drift" };

/** Runs of one state around the clock, so a stretch of focus is one arc. */
function runs(shape: string): { from: number; to: number; state: string }[] {
  const result: { from: number; to: number; state: string }[] = [];
  for (let slot = 0; slot < shape.length; slot += 1) {
    const state = shape[slot];
    if (state === ".") continue;
    const last = result[result.length - 1];
    if (last && last.state === state && last.to === slot) last.to = slot + 1;
    else result.push({ from: slot, to: slot + 1, state });
  }
  return result;
}

/**
 * The day it was earned, drawn the way Drifty records it: twenty-four hours
 * round the ring from the start of the day, focus, neutral and drift in the
 * app's own colours. Every badge carries the person's own day. Until earned
 * the ring is empty and fills grey toward the goal.
 */
export function AchievementDayRing({ id, group, state, detail, shape, progress }: AchievementArtProps) {
  const earned = state === "earned";
  const glyph = ACHIEVEMENT_GLYPH_PATHS[state === "concealed" ? "hidden" : id];
  return (
    <svg className="achievement-art achievement-day" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <circle className="adr-face" cx="50" cy="50" r={RING - 5} />
      <circle className="adr-track" cx="50" cy="50" r={RING} />
      {earned && shape
        ? runs(shape).map((run) => (
          <path key={run.from} className={"adr-run " + STATE_CLASS[run.state]} d={dialArc(RING, run.from / SLOTS, run.to / SLOTS)} />
        ))
        : null}
      {earned && !shape ? <circle className="adr-run adr-focus" cx="50" cy="50" r={RING} /> : null}
      {!earned && progress > 0 ? <path className="adr-run adr-progress" d={dialArc(RING, 0, progress)} /> : null}
      {detail
        ? [0, 0.25, 0.5, 0.75].map((turn) => {
          const inner = dialPoint(RING + 6.5, turn);
          const outer = dialPoint(RING + 9, turn);
          return <path key={turn} className="adr-hour" d={"M" + inner[0].toFixed(2) + " " + inner[1].toFixed(2) + "L" + outer[0].toFixed(2) + " " + outer[1].toFixed(2)} />;
        })
        : null}
      <g className="adr-glyph" transform="translate(50 50) scale(1.45) translate(-12 -12)">
        {glyph.map((d) => <path key={d} d={d} />)}
      </g>
    </svg>
  );
}
