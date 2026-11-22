import { ACHIEVEMENT_GLYPH_PATHS } from "./AchievementGlyph";
import type { AchievementId } from "./achievementCatalog";
import type { AchievementArtProps } from "./achievementArt";
import { SceneTile, sparklePath } from "./achievementScene";

type Point = readonly [number, number];

function ring(count: number, rx: number, ry: number, offset = 0): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index + offset) / count) * Math.PI * 2;
    return [rx * Math.sin(angle), -ry * Math.cos(angle)] as const;
  });
}

function mirrored(right: readonly Point[]): Point[] {
  const left = [...right].reverse().filter((point) => point[0] !== 0).map((point) => [-point[0], point[1]] as const);
  return [...right, ...left];
}

/** Outlines of the cuts, centred on the origin, about 90 across. */
const CUTS = {
  round: ring(12, 42, 42, 0.5),
  oval: ring(12, 34, 45, 0.5),
  emerald: [[-24, -43], [24, -43], [37, -30], [37, 30], [24, 43], [-24, 43], [-37, 30], [-37, -30]] as Point[],
  cushion: [[-26, -40], [26, -40], [38, -28], [40, 0], [38, 28], [26, 40], [-26, 40], [-38, 28], [-40, 0], [-38, -28]] as Point[],
  pear: mirrored([[0, -46], [15, -28], [28, -4], [33, 14], [28, 32], [15, 42], [0, 45]]),
  marquise: mirrored([[0, -48], [16, -32], [25, -12], [27, 4], [24, 20], [15, 36], [0, 48]]),
  trillion: [[0, -44], [12, -36], [42, 20], [40, 32], [30, 38], [-30, 38], [-40, 32], [-42, 20], [-12, -36]] as Point[],
  hexagon: ring(6, 44, 44, 0),
  /** Drifty's own mark: two triangles meeting at the waist. */
  hourglass: [[-38, -44], [38, -44], [6, -2], [38, 44], [-38, 44], [-6, -2]] as Point[],
};

type Cut = keyof typeof CUTS;

const CUT_BY_ID: Record<AchievementId, Cut> = {
  firstFlow: "round",
  flow90: "oval",
  flow180: "marquise",
  focusDay8h: "emerald",
  earlyStart: "pear",
  nightOwl: "trillion",
  weekendShift: "cushion",
  streak7: "hexagon",
  streak30: "emerald",
  focus100h: "hourglass",
  driftDay: "pear",
  noDriftDay: "trillion",
  comeback: "marquise",
};

const ROUGH: Point[] = [[-34, -16], [-12, -36], [18, -34], [40, -10], [36, 22], [8, 38], [-26, 30], [-42, 6]];
const LIGHT = -Math.PI * 0.75;

/**
 * A cut gem lit from the upper left: each facet between the outline and the
 * table takes a shade from how it faces the light. Until earned it is a rough
 * stone in the greys of the surface; more milestones add more glints.
 */
export function AchievementGem({ id, group, state, tier }: AchievementArtProps) {
  const earned = state === "earned";
  const outline = earned ? CUTS[CUT_BY_ID[id]] : ROUGH;
  const centre: Point = [75, 72];
  const table = outline.map((point) => [point[0] * 0.52, point[1] * 0.52 - 3] as const);
  const at = (point: Point) => (centre[0] + point[0]).toFixed(1) + " " + (centre[1] + point[1]).toFixed(1);
  const facets = outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length];
    const middle = Math.atan2((point[1] + next[1]) / 2, (point[0] + next[0]) / 2);
    const light = (Math.cos(middle - LIGHT) + 1) / 2;
    const shade = Math.min(4, Math.floor((1 - light) * 5));
    return { d: "M" + at(point) + "L" + at(next) + "L" + at(table[(index + 1) % table.length]) + "L" + at(table[index]) + "Z", shade };
  });
  const glints = earned ? Math.max(1, Math.min(tier, 4)) : 0;
  return (
    <SceneTile className="achievement-gem" group={group} state={state} tier={0} stone={id}
      after={state === "concealed" ? <text className="ac-question" x="75" y="84" fontSize="30" textAnchor="middle">?</text> : null}>
      <ellipse className={earned ? "ag-glow" : "ac-floor-shadow"} cx="75" cy="128" rx="34" ry="4.5" />
      <path className="ag-f2" d={"M" + outline.map(at).join("L") + "Z"} />
      {facets.map((facet) => <path key={facet.d} className={"ag-f" + facet.shade} d={facet.d} />)}
      <path className="ag-table" d={"M" + table.map(at).join("L") + "Z"} />
      {earned ? <path className="ag-star" d={table.map((point) => "M" + centre[0] + " " + (centre[1] - 3) + "L" + at(point)).join("")} /> : null}
      <path className="ag-edge" d={"M" + outline.map(at).join("L") + "Z"} />
      {earned ? (
        <g className="ag-engrave" transform={"translate(" + centre[0] + " " + (centre[1] - 3) + ") scale(" + (id === "focus100h" ? 0.55 : 0.85) + ") translate(-12 -12)"}>
          {ACHIEVEMENT_GLYPH_PATHS[id].map((d) => <path key={d} d={d} />)}
        </g>
      ) : null}
      {glints >= 1 ? <path className="ag-spark" d={sparklePath(centre[0] - 12, centre[1] - 16, 8)} /> : null}
      {glints >= 2 ? <path className="ag-spark ag-spark--air" d={sparklePath(120, 34, 6)} /> : null}
      {glints >= 3 ? <path className="ag-spark ag-spark--air" d={sparklePath(30, 110, 5)} /> : null}
      {glints >= 4 ? <path className="ag-spark ag-spark--air" d={sparklePath(124, 104, 5)} /> : null}
    </SceneTile>
  );
}
