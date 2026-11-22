import { createContext, useContext, useId, type CSSProperties, type ReactNode } from "react";
import type { AchievementArtProps } from "./achievementArt";
import type { AchievementGroup, AchievementId } from "./achievementCatalog";
import "./achievementOmo3.css";

/*
 * omo 3, "화분": every achievement is a small potted plant whose species tells
 * what was done. Milestones grow it (leaves, then buds, flowers and fruit; the
 * sixth earns a gold band on the pot). Locked shows the empty pot with the plant
 * pencilled in; concealed keeps the pot under a tied cloth.
 * Drawn in a 120 x 120 box; each plant is drawn upward from its soil at (0, 0).
 */

type Vars = CSSProperties & Record<`--${string}`, string>;

const Motion = createContext(false);

function r1(value: number) {
  return Math.round(value * 10) / 10;
}

/** A path template whose numbers are rounded to one decimal. */
function p(strings: TemplateStringsArray, ...values: number[]) {
  return strings.reduce((path, part, index) => path + part + (index < values.length ? String(r1(values[index] ?? 0)) : ""), "");
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
/** Entrance timing: lower parts grow first, flowers open last. */
const growAt = (y: number) => 300 + clamp01(-y / 70) * 620;
const bloomAt = (y: number) => 960 + clamp01(-y / 70) * 200;
const delay = (ms: number): Vars => ({ "--d": Math.round(ms) + "ms" });

function cls(...names: (string | false | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

type LeafKind = "almond" | "paddle" | "heart" | "jagged";

/** Leaf outlines pointing up from their base at the origin: [whole leaf, right half for the shade]. */
const LEAF: Record<LeafKind, (l: number, w: number) => readonly [string, string]> = {
  almond: (l, w) => [
    p`M0 0C${w} ${-l * 0.22} ${w * 0.86} ${-l * 0.72} 0 ${-l}C${-w * 0.86} ${-l * 0.72} ${-w} ${-l * 0.22} 0 0Z`,
    p`M0 0C${w} ${-l * 0.22} ${w * 0.86} ${-l * 0.72} 0 ${-l}Z`,
  ],
  paddle: (l, w) => [
    p`M0 0C${w * 0.45} ${-l * 0.12} ${w * 1.08} ${-l * 0.42} ${w * 0.86} ${-l * 0.8}C${w * 0.62} ${-l * 1.06} ${-w * 0.62} ${-l * 1.06} ${-w * 0.86} ${-l * 0.8}C${-w * 1.08} ${-l * 0.42} ${-w * 0.45} ${-l * 0.12} 0 0Z`,
    p`M0 0C${w * 0.45} ${-l * 0.12} ${w * 1.08} ${-l * 0.42} ${w * 0.86} ${-l * 0.8}C${w * 0.68} ${-l * 1.0} ${w * 0.3} ${-l * 1.0} 0 ${-l * 0.99}Z`,
  ],
  heart: (l, w) => [
    p`M0 ${-l * 0.1}C${w * 0.35} ${l * 0.02} ${w * 1.02} ${-l * 0.05} ${w * 0.98} ${-l * 0.42}C${w * 0.92} ${-l * 0.72} ${w * 0.38} ${-l * 0.86} 0 ${-l}C${-w * 0.38} ${-l * 0.86} ${-w * 0.92} ${-l * 0.72} ${-w * 0.98} ${-l * 0.42}C${-w * 1.02} ${-l * 0.05} ${-w * 0.35} ${l * 0.02} 0 ${-l * 0.1}Z`,
    p`M0 ${-l * 0.1}C${w * 0.35} ${l * 0.02} ${w * 1.02} ${-l * 0.05} ${w * 0.98} ${-l * 0.42}C${w * 0.92} ${-l * 0.72} ${w * 0.38} ${-l * 0.86} 0 ${-l}Z`,
  ],
  jagged: (l, w) => {
    const side: [number, number][] = [];
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const width = w * Math.sin(Math.PI * Math.min(0.92, t)) ** 0.6;
      side.push([width * 1.05, -l * (t - 0.07)], [width * 0.5, -l * (t + 0.05)]);
    }
    const right = side.map(([x, y]) => p`L${x} ${y}`).join("");
    const left = [...side].reverse().map(([x, y]) => p`L${-x} ${y}`).join("");
    return [p`M0 0` + right + p`L0 ${-l}` + left + "Z", p`M0 0` + right + p`L0 ${-l}Z`];
  },
};

type LeafProps = {
  readonly x: number;
  readonly y: number;
  readonly a: number;
  readonly l: number;
  readonly w: number;
  readonly kind?: LeafKind;
  readonly tone?: string;
  readonly fine?: boolean;
  readonly at?: number;
};

function Leaf({ x, y, a, l, w, kind = "almond", tone = "leaf", fine = false, at }: LeafProps) {
  const [whole, half] = LEAF[kind](l, w);
  return (
    <g transform={p`translate(${x} ${y}) rotate(${a})`} className={fine ? "omo3-fine" : undefined}>
      <g className={"omo3-g omo3-t-" + tone} style={delay(at ?? growAt(y))}>
        <path className="omo3-body" d={whole} />
        <path className="omo3-tint" d={half} />
        <path className="omo3-rib" d={p`M0 ${-l * 0.14}L0 ${-l * 0.76}`} />
      </g>
    </g>
  );
}

function Stem({ d, w = 2.4, tone = "stem", at = 160, fine = false }: { readonly d: string; readonly w?: number; readonly tone?: string; readonly at?: number; readonly fine?: boolean }) {
  const motion = useContext(Motion);
  return (
    <path
      className={cls("omo3-stem", "omo3-t-" + tone, fine && "omo3-fine")}
      d={d}
      pathLength={motion ? 1 : undefined}
      style={{ ...delay(at), "--sw": String(w) } as Vars}
    />
  );
}

/** A group that grows in from its base ("b") or opens from its centre ("c"). */
function G({ at, o = "b", tone, fine = false, children }: { readonly at: number; readonly o?: "b" | "c" | "f"; readonly tone?: string; readonly fine?: boolean; readonly children: ReactNode }) {
  return (
    <g className={cls("omo3-g", tone && "omo3-t-" + tone, fine && "omo3-fine")} data-o={o} style={delay(at)}>
      {children}
    </g>
  );
}

type BloomProps = {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly n: number;
  readonly pw?: number;
  readonly rot?: number;
  readonly tone: string;
  readonly core?: string;
  readonly coreR?: number;
  readonly at?: number;
  readonly fine?: boolean;
  readonly children?: ReactNode;
};

/** A flower seen face-on: n petals around a core. */
function Bloom({ x, y, r, n, pw = 0.36, rot = 0, tone, core, coreR = r * 0.32, at, fine = false, children }: BloomProps) {
  return (
    <g transform={p`translate(${x} ${y})`} className={fine ? "omo3-fine" : undefined}>
      <G at={at ?? bloomAt(y)} o="c">
        <g className={"omo3-t-" + tone}>
          {Array.from({ length: n }, (_, index) => (
            <ellipse
              key={index}
              className={index % 2 ? "omo3-body omo3-alt" : "omo3-body"}
              cx="0"
              cy={r1(-r * 0.52)}
              rx={r1(r * pw)}
              ry={r1(r * 0.5)}
              transform={"rotate(" + r1(rot + (index * 360) / n) + ")"}
            />
          ))}
        </g>
        {core ? <circle className={"omo3-body omo3-t-" + core} r={r1(coreR)} /> : null}
        {children}
      </G>
    </g>
  );
}

/** A round fruit or berry with a small highlight. */
function Fruit({ x, y, r, tone, at }: { readonly x: number; readonly y: number; readonly r: number; readonly tone: string; readonly at?: number }) {
  return (
    <g transform={p`translate(${x} ${y})`}>
      <G at={at ?? bloomAt(y) + 140} o="c" tone={tone}>
        <circle className="omo3-body" r={r1(r)} />
        <circle className="omo3-tint" cx={r1(r * 0.3)} cy={r1(r * 0.3)} r={r1(r * 0.62)} />
        <circle className="omo3-hi omo3-fine" cx={r1(-r * 0.34)} cy={r1(-r * 0.36)} r={r1(r * 0.28)} />
      </G>
    </g>
  );
}

/* ── The thirteen plants ────────────────────────────────────────────────── */

/** First sprout: two seed leaves and the first true leaf between them. */
function FirstFlow() {
  return (
    <>
      <Stem d="M0 2C1.6 -8 -2.6 -20 0 -31" w={3.2} />
      <Leaf x={0} y={-30} a={-66} l={24} w={12.5} kind="paddle" />
      <Leaf x={0} y={-30} a={66} l={24} w={12.5} kind="paddle" />
      <Leaf x={0} y={-31} a={-8} l={13} w={5.6} tone="leaf2" />
      <Leaf x={0} y={-31} a={22} l={9} w={4.2} tone="leaf2" fine />
    </>
  );
}

/** A young citrus sapling: leaves, then white blossom, then small fruit. */
function Flow90({ s }: { readonly s: number }) {
  const h = [36, 38, 40, 42, 43, 44][s - 1] ?? 44;
  const nodes: readonly (readonly [number, number])[] = [[0.42, -1], [0.58, 1], [0.72, -1], [0.85, 1]];
  const shown = s === 1 ? 2 : s === 2 ? 3 : 4;
  const blossoms: readonly (readonly [number, number])[] = s === 4 ? [[7, -0.66], [-7, -0.5]] : s === 5 ? [[-7, -0.5]] : s >= 6 ? [[-7.5, -0.46], [1, -1.12]] : [];
  const fruit: readonly (readonly [number, number])[] = s === 5 ? [[7, -0.64], [-6.5, -0.8]] : s >= 6 ? [[7, -0.64], [-6.5, -0.8], [7.5, -0.92], [-7, -0.62]] : [];
  return (
    <>
      <Stem d={p`M0 2C-1.4 ${-h * 0.4} 1.4 ${-h * 0.7} 0 ${-h}`} w={2.8} tone="wood" />
      {nodes.slice(0, shown).map(([at, side]) => (
        <Leaf key={at} x={side * 0.6} y={-h * at} a={side * 54} l={17.5} w={8} />
      ))}
      <Leaf x={0} y={-h} a={-18} l={17.5} w={8} />
      <Leaf x={0} y={-h} a={22} l={14} w={7} tone="leaf2" />
      {s === 3 ? <><Fruit x={6} y={-h * 0.6} r={2} tone="blossom" /><Fruit x={-6} y={-h * 0.48} r={2} tone="blossom" /></> : null}
      {blossoms.map(([x, at]) => <Bloom key={x} x={x} y={h * at} r={5.6} n={5} pw={0.48} tone="blossom" core="sun" coreR={1.5} />)}
      {fruit.map(([x, at]) => <Fruit key={x + ":" + at} x={x} y={h * -Math.abs(at)} r={4.4} tone="citrus" />)}
    </>
  );
}

function flame(height: number, width: number, base: number) {
  return [
    p`M0 ${-height}C${width * 0.5} ${-height * 0.84} ${width * 1.06} ${-height * 0.52} ${width * 0.94} ${-base - 6}Q${width * 0.82} ${-base} 0 ${-base}Q${-width * 0.82} ${-base} ${-width * 0.94} ${-base - 6}C${-width * 1.06} ${-height * 0.52} ${-width * 0.5} ${-height * 0.84} 0 ${-height}Z`,
    p`M0 ${-height}C${width * 0.5} ${-height * 0.84} ${width * 1.06} ${-height * 0.52} ${width * 0.94} ${-base - 6}Q${width * 0.82} ${-base} 0 ${-base}Z`,
  ] as const;
}

/** A tall straight cypress: it grows taller, then sets cones. */
function Flow180({ s }: { readonly s: number }) {
  const h = [44, 47, 50, 52, 55, 57][s - 1] ?? 57;
  const w = [10.4, 10.8, 11.4, 12, 12.6, 13.2][s - 1] ?? 13.2;
  const [outline, shade] = flame(h, w, 5);
  const tufts = s >= 2 ? [0.32, 0.5, 0.68].slice(0, s >= 3 ? 3 : 2) : [];
  const cones: readonly (readonly [number, number])[] = [[-4.5, 0.4], [5, 0.56], [-3, 0.7], [5.5, 0.3], [0.5, 0.48], [-6, 0.24], [3, 0.8]];
  const coneCount = [0, 0, 3, 4, 6, 7][s - 1] ?? 7;
  const coneTone = s === 3 ? "leaf" : "cone";
  return (
    <>
      <G at={180} tone="wood"><rect className="omo3-body" x="-2.2" y="-8" width="4.4" height="9" rx="1" /></G>
      <G at={280} tone="leaf2">
        <path className="omo3-body" d={outline} />
        <path className="omo3-tint" d={shade} />
        {tufts.map((at) => (
          <path key={at} className="omo3-rib" d={p`M${-w * 0.55} ${-h * at + 3}Q0 ${-h * at - 3} ${w * 0.55} ${-h * at + 3}`} />
        ))}
      </G>
      {cones.slice(0, coneCount).map(([x, at]) => <Fruit key={x + ":" + at} x={x} y={-h * at - 4} r={2.3} tone={coneTone} />)}
    </>
  );
}

/** Sunflower: a bud first, then the open head, then a second flower. */
function FocusDay8h({ s }: { readonly s: number }) {
  const h = [36, 38, 40, 41, 43, 44][s - 1] ?? 44;
  const sideBranch = s >= 5;
  return (
    <>
      <Stem d={p`M0 2C-1.6 ${-h * 0.35} 1.6 ${-h * 0.7} 0 ${-h}`} w={3.4} />
      {sideBranch ? <Stem d={p`M0 ${-h * 0.45}C4 ${-h * 0.5} 9 ${-h * 0.58} 12 ${-h * 0.7}`} w={2} at={520} /> : null}
      <Leaf x={0} y={-h * 0.3} a={-60} l={20} w={10} kind="heart" />
      <Leaf x={0} y={-h * 0.48} a={58} l={19} w={9.5} kind="heart" />
      {s >= 2 ? <Leaf x={0} y={-h * 0.14} a={66} l={13} w={6.6} kind="heart" tone="leaf2" /> : null}
      {s >= 2 ? <Leaf x={0} y={-h * 0.66} a={-52} l={12} w={6} kind="heart" tone="leaf2" /> : null}
      {s <= 2 ? (
        <Bloom x={0} y={-h} r={s === 1 ? 9 : 10} n={7} pw={0.5} tone="leaf2" core="leaf" coreR={s === 1 ? 4.4 : 5} />
      ) : s === 3 ? (
        <Bloom x={0} y={-h} r={10} n={12} pw={0.3} tone="sun" core="leaf2" coreR={5.6} />
      ) : (
        <Bloom x={0} y={-h} r={s === 4 ? 13.5 : s === 5 ? 15.5 : 17} n={s >= 6 ? 18 : 14} pw={0.28} tone="sun" core="sunCore" coreR={s === 4 ? 5.4 : s === 5 ? 6.4 : 7}>
          {s >= 6 ? <circle className="omo3-ring omo3-fine" r="4.2" /> : null}
        </Bloom>
      )}
      {sideBranch ? (
        s >= 6
          ? <Bloom x={13} y={-h * 0.72} r={7.4} n={11} pw={0.3} tone="sun" core="sunCore" coreR={2.8} />
          : <Bloom x={13} y={-h * 0.72} r={4.4} n={6} pw={0.5} tone="leaf2" core="sun" coreR={2} />
      ) : null}
    </>
  );
}

/** A trumpet flower seen face-on, with the pale throat of a morning glory. */
function Trumpet({ x, y, r, tone, throat, at }: { readonly x: number; readonly y: number; readonly r: number; readonly tone: string; readonly throat: string; readonly at?: number }) {
  return (
    <g transform={p`translate(${x} ${y})`}>
      <G at={at ?? bloomAt(y)} o="c">
        <circle className={"omo3-body omo3-t-" + tone} r={r1(r)} />
        <g className={"omo3-t-" + tone}>
          {[0, 72, 144, 216, 288].map((turn) => (
            <path key={turn} className="omo3-line omo3-fine" d={p`M0 ${-r * 0.3}L0 ${-r * 0.95}`} transform={"rotate(" + turn + ")"} />
          ))}
        </g>
        <circle className={"omo3-body omo3-t-" + throat} r={r1(r * 0.42)} />
        <circle className="omo3-body omo3-t-sun omo3-fine" r={r1(r * 0.14)} />
      </G>
    </g>
  );
}

/** A furled flower bud: a twisted cone. */
function Bud({ x, y, a = 0, l, tone }: { readonly x: number; readonly y: number; readonly a?: number; readonly l: number; readonly tone: string }) {
  return (
    <g transform={p`translate(${x} ${y}) rotate(${a})`}>
      <G at={bloomAt(y) - 80} tone={tone}>
        <path className="omo3-body" d={p`M0 0C${l * 0.34} ${-l * 0.3} ${l * 0.24} ${-l * 0.78} 0 ${-l}C${-l * 0.24} ${-l * 0.78} ${-l * 0.34} ${-l * 0.3} 0 0Z`} />
        <path className="omo3-tint" d={p`M0 0C${l * 0.34} ${-l * 0.3} ${l * 0.24} ${-l * 0.78} 0 ${-l}C${l * 0.02} ${-l * 0.6} ${-l * 0.08} ${-l * 0.3} 0 0Z`} />
      </G>
    </g>
  );
}

/** Morning glory climbing a small hoop trellis; flowers open with the milestones. */
function EarlyStart({ s }: { readonly s: number }) {
  const leaves: readonly (readonly [number, number, number, number])[] = [
    [-15, -9, -78, 1], [-16, -21, -74, 1], [-13.5, -30, 48, 1], [-16, -40, -58, 1], [-7, -48.5, -24, 1],
    [7, -49, 30, 2], [15.5, -40, 70, 3], [16, -25, 78, 4], [13.5, -13, 62, 5],
  ];
  return (
    <>
      <G at={140} tone="wood"><path className="omo3-wire" d="M-15 2V-34A15 15 0 0 1 15 -34V2M-15 -17H15" /></G>
      <Stem d="M-4 2C-19 -3 -11 -12 -16 -19C-21 -27 -10 -31 -15 -39" w={1.8} />
      <Stem d="M-15 -39C-18 -46 -10 -51 -1 -49.5C7 -48.5 14 -47 15 -39" w={1.8} at={420} />
      {s >= 3 ? <Stem d="M15 -39C14 -31 19 -27 16 -19C14 -14 17 -9 15 -4" w={1.8} at={600} /> : null}
      {leaves.filter(([, , , from]) => s >= from).map(([x, y, a]) => (
        <Leaf key={x + ":" + y} x={x} y={y} a={a} l={11} w={6.4} kind="heart" />
      ))}
      {s === 3 ? <><Bud x={-2} y={-50} a={-20} l={9} tone="glory" /><Bud x={15} y={-39} a={30} l={8} tone="glory" /></> : null}
      {s === 4 ? <Bud x={15} y={-39} a={30} l={8} tone="glory" /> : null}
      {s >= 4 ? <Trumpet x={-2} y={-52} r={s >= 6 ? 10.5 : 9.5} tone="glory" throat="moon" /> : null}
      {s >= 5 ? <Trumpet x={17} y={-31} r={8} tone="glory" throat="moon" /> : null}
      {s >= 6 ? <Trumpet x={-20} y={-34} r={7.4} tone="glory" throat="moon" /> : null}
    </>
  );
}

/** Moonflower: broad heart leaves and a pale bloom that opens at night. */
function NightOwl({ s }: { readonly s: number }) {
  const h = [38, 40, 42, 43, 45, 46][s - 1] ?? 46;
  const bloomR = s === 4 ? 12.5 : 14;
  return (
    <>
      <Stem d={p`M0 2C3.5 ${-h * 0.3} -3.5 ${-h * 0.62} 0 ${-h}`} w={2.6} />
      {s >= 5 ? <Stem d={p`M0 ${-h * 0.5}C6 ${-h * 0.56} 12 ${-h * 0.6} 16 ${-h * 0.72}`} w={1.8} at={520} /> : null}
      <Leaf x={0} y={-h * 0.24} a={-64} l={17} w={10.5} kind="heart" />
      <Leaf x={0} y={-h * 0.44} a={60} l={16} w={10} kind="heart" />
      {s >= 2 ? <Leaf x={0} y={-h * 0.1} a={74} l={12} w={7.4} kind="heart" tone="leaf2" /> : null}
      {s >= 2 ? <Leaf x={0} y={-h * 0.64} a={-56} l={12} w={7.4} kind="heart" tone="leaf2" /> : null}
      {s <= 3 ? (
        <Bud x={0} y={-h + 2} l={s === 1 ? 13 : s === 2 ? 14 : 15} tone="moon" />
      ) : (
        <Bloom x={0} y={-h - 3} r={bloomR} n={5} pw={0.62} rot={36} tone="moon" core="moonCore" coreR={bloomR * 0.24}>
          <g className="omo3-t-moonCore omo3-fine">
            {[0, 72, 144, 216, 288].map((turn) => (
              <path key={turn} className="omo3-line" d={p`M0 ${-bloomR * 0.3}L0 ${-bloomR * 0.86}`} transform={"rotate(" + turn + ")"} />
            ))}
          </g>
        </Bloom>
      )}
      {s === 5 ? <Bud x={16} y={-h * 0.72} a={34} l={10} tone="moon" /> : null}
      {s >= 6 ? <Bloom x={18} y={-h * 0.76} r={8.6} n={5} pw={0.62} rot={20} tone="moon" core="moonCore" coreR={2.2} /> : null}
    </>
  );
}

function tulip(k: number) {
  const q = k / 7;
  return [
    p`M${-1 * q} 0C${-6 * q} 0 ${-7.2 * q} ${-4.4 * q} ${-6.6 * q} ${-9.4 * q}L${-4.2 * q} ${-12.6 * q}L${-2.3 * q} ${-9 * q}L0 ${-13.6 * q}L${2.3 * q} ${-9 * q}L${4.2 * q} ${-12.6 * q}L${6.6 * q} ${-9.4 * q}C${7.2 * q} ${-4.4 * q} ${6 * q} 0 ${1 * q} 0Z`,
    p`M${-2.3 * q} ${-9 * q}L0 ${-13.6 * q}L${2.3 * q} ${-9 * q}C${2.2 * q} ${-4.6 * q} ${1.2 * q} ${-0.6 * q} 0 0C${-1.2 * q} ${-0.6 * q} ${-2.2 * q} ${-4.6 * q} ${-2.3 * q} ${-9 * q}Z`,
  ] as const;
}

/** Two matching tulips side by side: Saturday and Sunday. */
function WeekendShift({ s }: { readonly s: number }) {
  const h = [34, 37, 39, 41, 43, 44][s - 1] ?? 44;
  const size = [7, 7.6, 8.2, 9, 9.8, 10.6][s - 1] ?? 10.6;
  const tone = s <= 2 ? "leaf2" : "tulip";
  const [cup, front] = tulip(size);
  return (
    <>
      {[-1, 1].map((side) => {
        const x = side * 10;
        const top = x + side * 2.4;
        return (
          <g key={side}>
            <Stem d={p`M${x} 2C${x} ${-h * 0.5} ${top} ${-h * 0.78} ${top} ${-h}`} w={2.6} />
            <Leaf x={x} y={-1} a={side * 26} l={22} w={5.4} />
            {s >= 2 ? <Leaf x={x} y={-2} a={-side * 14} l={17} w={4.6} tone="leaf2" /> : null}
            {s >= 5 ? <Leaf x={x} y={-1} a={side * 52} l={15} w={4.4} tone="leaf2" fine /> : null}
            <g transform={p`translate(${top} ${-h + 1.5})`}>
              <G at={bloomAt(-h)} tone={tone}>
                <path className="omo3-body" d={cup} />
                <path className={s === 3 ? "omo3-hi" : "omo3-tint"} d={front} />
              </G>
            </g>
          </g>
        );
      })}
    </>
  );
}

/** One stalk with its seven leaves, counted up the stem, and a flower on top. */
function Streak7({ s }: { readonly s: number }) {
  const h = [48, 49, 50, 51, 51, 52][s - 1] ?? 52;
  const grow = s === 1 ? 0.9 : s === 2 ? 0.95 : 1;
  const nodes = [0.13, 0.26, 0.38, 0.5, 0.61, 0.71, 0.8];
  return (
    <>
      <Stem d={p`M0 2L0 ${-h}`} w={2.6} />
      {nodes.map((at, index) => {
        const side = index % 2 ? 1 : -1;
        return <Leaf key={at} x={side * 0.6} y={-h * at} a={side * 56} l={(15.5 - index * 0.9) * grow} w={(6.4 - index * 0.3) * grow} />;
      })}
      {s <= 2 ? <Bud x={0} y={-h + 2} l={s === 1 ? 5 : 6} tone="leaf2" /> : null}
      {s === 3 ? <Bud x={0} y={-h + 2} l={9} tone="lavender" /> : null}
      {s >= 4 ? <Bloom x={0} y={-h - 4} r={s === 4 ? 8 : s === 5 ? 9 : 10} n={6} pw={0.44} tone="lavender" core="sun" coreR={2.4} /> : null}
      {s >= 5 ? <Bud x={-4} y={-h * 0.86} a={-40} l={6} tone="lavender" /> : null}
      {s >= 6 ? <Bud x={4} y={-h * 0.9} a={40} l={6} tone="lavender" /> : null}
    </>
  );
}

function Culm({ x, h, at }: { readonly x: number; readonly h: number; readonly at: number }) {
  const segment = 9.2;
  const count = Math.max(1, Math.round(h / segment));
  return (
    <G at={at} tone="bamboo">
      {Array.from({ length: count }, (_, index) => (
        <rect key={index} className="omo3-body" x={r1(x - 2.5)} y={r1(-(index + 1) * segment + 0.7)} width="5" height={r1(segment - 1.4)} rx="1.4" />
      ))}
      {Array.from({ length: count }, (_, index) => (
        <rect key={"t" + index} className="omo3-tint" x={r1(x + 0.6)} y={r1(-(index + 1) * segment + 0.7)} width="1.9" height={r1(segment - 1.4)} rx="0.9" />
      ))}
      {Array.from({ length: count - 1 }, (_, index) => (
        <rect key={"n" + index} className="omo3-node" x={r1(x - 3.1)} y={r1(-(index + 1) * segment - 0.7)} width="6.2" height="1.4" rx="0.7" />
      ))}
    </G>
  );
}

/** Bamboo: segmented culms that multiply, with new shoots at the base. */
function Streak30({ s }: { readonly s: number }) {
  const h = [46, 46, 55, 55, 55, 55][s - 1] ?? 55;
  const segment = 9.2;
  const culms: readonly (readonly [number, number, number])[] = [
    [-1, h, 1],
    [-12, Math.round(h * 0.8 / segment) * segment, 1],
    [10, Math.round(h * 0.64 / segment) * segment, 2],
  ];
  const visible = culms.filter(([, , from]) => s >= from);
  return (
    <>
      {visible.map(([x, height], index) => <Culm key={x} x={x} h={height} at={200 + index * 120} />)}
      {visible.map(([x, height]) => {
        const top = -Math.round(height / segment) * segment;
        const angles = s >= 5 ? [-62, -28, 30, 64] : [-56, 50];
        return angles.map((a, index) => (
          <Leaf key={x + ":" + a} x={x} y={top + (index % 2) * 9.2 + 1} a={a} l={s >= 4 ? 15 : 13} w={3.4} />
        ));
      })}
      {s >= 4 ? <Shoot x={17} k={s >= 6 ? 1.2 : 1} /> : null}
      {s >= 5 ? <Shoot x={-20} k={0.8} /> : null}
    </>
  );
}

function Shoot({ x, k }: { readonly x: number; readonly k: number }) {
  return (
    <g transform={p`translate(${x} 1)`}>
      <G at={760} tone="cone">
        <path className="omo3-body" d={p`M${-3.2 * k} 0C${-3 * k} ${-4 * k} ${-1.4 * k} ${-8 * k} 0 ${-10 * k}C${1.4 * k} ${-8 * k} ${3 * k} ${-4 * k} ${3.2 * k} 0Z`} />
        <path className="omo3-tint" d={p`M0 ${-10 * k}C${1.4 * k} ${-8 * k} ${3 * k} ${-4 * k} ${3.2 * k} 0L0 0Z`} />
      </G>
    </g>
  );
}

/** A round olive bonsai: crowned canopy and olives. */
function Focus100h() {
  const clumps: readonly (readonly [number, number, number])[] = [
    [-15, -30, 10], [14, -31, 10.5], [-13, -45, 10.5], [12, -46, 11], [0, -54, 10], [0, -39, 13],
  ];
  const olives: readonly (readonly [number, number, number])[] = [[-17, -27, 20], [8, -33, -30], [-6, -47, 10], [17, -44, 40], [3, -56, -10], [-14, -40, -20], [16, -27, 30]];
  return (
    <>
      <G at={160} tone="wood">
        <path className="omo3-body" d="M-4.5 2C-3.5 -6 -9 -11 -7 -19C-5.6 -24 -1.6 -26 -1 -32L3 -32C3 -25 6 -19 4.6 -11C4 -5 4.4 -1.5 5.5 2Z" />
        <path className="omo3-tint" d="M1.2 -32H3C3 -25 6 -19 4.6 -11C4 -5 4.4 -1.5 5.5 2H1.6C2 -6 0.6 -12 1.8 -19C2.6 -24 1.2 -28 1.2 -32Z" />
        <path className="omo3-wire" d="M-6 -16C-11 -19 -14 -22 -15 -27M3.5 -15C8 -18 11 -23 13 -28" />
      </G>
      {clumps.map(([x, y, r]) => (
        <g key={x + ":" + y} transform={p`translate(${x} ${y})`}>
          <G at={growAt(y) + 60} o="c" tone="sage">
            <circle className="omo3-tint" cx="1.2" cy="1.4" r={r} />
            <circle className="omo3-body" cx="-0.6" cy="-0.8" r={r1(r - 1.4)} />
          </G>
        </g>
      ))}
      {olives.map(([x, y, a]) => (
        <g key={x + ":" + y} transform={p`translate(${x} ${y}) rotate(${a})`}>
          <G at={bloomAt(y) + 120} o="c" tone="olive"><ellipse className="omo3-body" rx="1.9" ry="2.7" /></G>
        </g>
      ))}
    </>
  );
}

/** A drifting seed: a stalk under a small fluffy fan. */
function Seed({ x, y, a, at }: { readonly x: number; readonly y: number; readonly a: number; readonly at: number }) {
  return (
    <g transform={p`translate(${x} ${y}) rotate(${a})`}>
      <G at={at} o="c" tone="puff">
        <path className="omo3-wire" d="M0 5V-2.2M0 -2.2L-3.8 -5.6M0 -2.2L0 -6.8M0 -2.2L3.8 -5.6" />
        <ellipse className="omo3-seed" cx="0" cy="5.4" rx="1.1" ry="1.7" />
      </G>
    </g>
  );
}

/** A dandelion clock letting its seeds go. */
function DriftDay({ s }: { readonly s: number }) {
  const h = [46, 48, 50, 51, 52, 53][s - 1] ?? 53;
  const R = [14, 14.6, 15.2, 15.8, 16.4, 17][s - 1] ?? 17;
  const cx = 1;
  const cy = -h;
  const seeds: readonly (readonly [number, number, number])[] = [
    [18, -4, 34], [24, -10, 46], [15, -15, 18], [28, 2, 58], [30, -14, 40], [34, -5, 56], [31, 10, 66],
  ];
  const count = [1, 2, 3, 4, 5, 7][s - 1] ?? 7;
  const rays = 20;
  return (
    <>
      <Leaf x={-1.5} y={0} a={-64} l={16} w={5.2} kind="jagged" />
      <Leaf x={1.5} y={0} a={62} l={15} w={5} kind="jagged" />
      <Leaf x={0} y={-0.5} a={-30} l={12} w={4.2} kind="jagged" tone="leaf2" fine />
      {s >= 3 ? <Stem d="M-1 1C-4 -8 -8 -14 -10 -20" w={1.8} at={420} /> : null}
      {s === 3 ? <Bud x={-10} y={-20} a={-24} l={6.5} tone="dand" /> : null}
      {s >= 4 ? <Bloom x={-10.5} y={-22} r={s >= 6 ? 7.4 : 6.4} n={16} pw={0.22} tone="dand" core="dandCore" coreR={1.8} /> : null}
      <Stem d={p`M0 2C2.4 ${-h * 0.3} -2.4 ${-h * 0.64} ${cx} ${cy}`} w={1.9} />
      <g transform={p`translate(${cx} ${cy})`}>
        <G at={1020} o="c" tone="puff">
          <circle className="omo3-halo" r={r1(R)} />
          {Array.from({ length: rays }, (_, index) => {
            const turn = (index * 360) / rays;
            const gone = turn > 20 && turn < 20 + count * 9;
            return gone ? null : (
              <g key={index} transform={"rotate(" + r1(turn) + ")"} className="omo3-fine">
                <path className="omo3-wire" d={p`M0 -2L0 ${-R + 1.2}`} />
                <circle className="omo3-seed" cy={r1(-R + 1)} r="1.05" />
              </g>
            );
          })}
          <circle className="omo3-body omo3-t-wood" r="2.3" />
        </G>
      </g>
      {seeds.slice(0, count).map(([dx, dy, a], index) => (
        <Seed key={dx + ":" + dy} x={cx + dx} y={cy + dy} a={a} at={1200 + index * 70} />
      ))}
    </>
  );
}

/** A lotus on still water in a glass jar: it opens wider and gains a bud with the milestones. */
function NoDriftDay({ s }: { readonly s: number }) {
  const r = [21, 22.5, 23.5, 25, 26.5, 28][s - 1] ?? 28;
  const petals: readonly (readonly [number, number, number])[] = s <= 2
    ? [[-28, 0.8, 0.4], [28, 0.8, 0.4], [0, 1, 0.42]]
    : [[-68, 0.6, 0.42], [68, 0.6, 0.42], [-35, 0.84, 0.42], [35, 0.84, 0.42], [0, 1, 0.42]];
  return (
    <>
      <g transform="scale(0.82)">
        <G at={260} o="c" tone="pad">
          <path className="omo3-body" d="M-21 0.6C-21 -2 -15 -3.4 -8.6 -3.4C-4 -3.4 -0.6 -2.8 1.8 -1.8L-7 0.2L3.6 1.6C0.4 3.2 -4 3.6 -8.6 3.6C-15 3.6 -21 2.8 -21 0.6Z" />
          <path className="omo3-tint" d="M-21 0.6C-21 2.8 -15 3.6 -8.6 3.6C-4 3.6 0.4 3.2 3.6 1.6L-7 0.2Z" />
        </G>
        {s >= 2 ? (
          <G at={360} o="c" tone="pad">
            <path className="omo3-body" d="M7 0.4C7 -1.4 11 -2.4 15 -2.4C18 -2.4 21 -1.6 21 0.2C21 1.8 18 2.6 14.5 2.6C12 2.6 9.6 2.2 8.4 1.6L14 0.2Z" />
          </G>
        ) : null}
      </g>
      <g transform="scale(1.55)">
        {s >= 6 ? [-48, 48].map((a) => <Leaf key={a} x={0} y={-1} a={a} l={r * 0.84} w={r * 0.3} tone="lotus2" at={bloomAt(-10) - 40} />) : null}
        {petals.map(([a, len, wide]) => (
          <Leaf key={a} x={0} y={-1} a={a} l={r * len} w={r * wide} tone="lotus" at={bloomAt(-10) + Math.abs(a) * 2} />
        ))}
        {s >= 6 ? <g transform="translate(0 -8)"><G at={1420} o="c" tone="sun"><path className="omo3-body omo3-fine" d="M-4.4 1L-3.6 -2.8H3.6L4.4 1Z" /></G></g> : null}
        {s >= 5 ? <Bud x={-11} y={-1} a={-16} l={10} tone="lotus" /> : null}
      </g>
    </>
  );
}

/** A cut stump with a fresh shoot rising from it. */
function Comeback({ s }: { readonly s: number }) {
  const h = [22, 26, 30, 33, 37, 40][s - 1] ?? 40;
  const base = -17;
  const top = base - h;
  const spots: readonly (readonly [number, number, number, number])[] = [
    [0.55, -1, 8.6, 1], [0.8, 1, 8.6, 1], [0.3, 1, 10, 2], [0.5, -1, 10, 2], [0.7, 1, 9, 4],
  ];
  return (
    <>
      <G at={120} tone="stump">
        <path className="omo3-body" d="M-14 2C-11.5 0 -11 -2 -11 -5V-16H11V-5C11 -2 11.5 0 14 2Z" />
        <path className="omo3-tint" d="M5 -16H11V-5C11 -2 11.5 0 14 2H6.5C5.5 -2 5 -8 5 -16Z" />
        <path className="omo3-wire omo3-fine" d="M-6 -12V-4M-1 -10V-2M2 -13V-7" />
        <ellipse className="omo3-cut" cx="0" cy="-16" rx="11" ry="3.6" />
        <ellipse className="omo3-ringline omo3-fine" cx="0" cy="-16" rx="6.6" ry="2" />
        <ellipse className="omo3-ringline omo3-fine" cx="0" cy="-16" rx="2.8" ry="0.9" />
      </G>
      <Stem d={p`M4 ${base + 1}C4.5 ${base - h * 0.4} 1.5 ${base - h * 0.7} 3 ${top}`} w={2.4} at={420} />
      {spots.filter(([, , , from]) => s >= from).map(([at, side, l]) => (
        <Leaf key={at} x={3.6} y={base - h * at} a={side * 56} l={l} w={4.6} at={520 + at * 500} />
      ))}
      <Leaf x={3} y={top} a={-14} l={8} w={4} tone="leaf2" at={900} />
      {s === 3 ? <Bud x={3} y={top} a={10} l={7} tone="tulip" /> : null}
      {s >= 4 ? <Bloom x={3} y={top - 3} r={s >= 6 ? 7.6 : 6.6} n={5} pw={0.5} tone="tulip" core="sun" coreR={2} /> : null}
      {s >= 5 ? (
        <>
          <Stem d="M-9 -12C-14 -18 -16 -24 -14 -30" w={2} at={760} />
          <Leaf x={-14} y={-26} a={-56} l={8} w={4} at={1000} />
          <Leaf x={-14} y={-30} a={20} l={7} w={3.6} tone="leaf2" at={1060} />
        </>
      ) : null}
      {s >= 6 ? <Bloom x={-14} y={-33} r={5.6} n={5} pw={0.5} tone="tulip" core="sun" coreR={1.6} /> : null}
    </>
  );
}

const PLANTS: Record<AchievementId, (s: number) => ReactNode> = {
  firstFlow: () => <FirstFlow />,
  flow90: (s) => <Flow90 s={s} />,
  flow180: (s) => <Flow180 s={s} />,
  focusDay8h: (s) => <FocusDay8h s={s} />,
  earlyStart: (s) => <EarlyStart s={s} />,
  nightOwl: (s) => <NightOwl s={s} />,
  weekendShift: (s) => <WeekendShift s={s} />,
  streak7: (s) => <Streak7 s={s} />,
  streak30: (s) => <Streak30 s={s} />,
  focus100h: () => <Focus100h />,
  driftDay: (s) => <DriftDay s={s} />,
  noDriftDay: (s) => <NoDriftDay s={s} />,
  comeback: (s) => <Comeback s={s} />,
};

/** Small things in the sky that belong to a plant's hour. */
function Sky({ id }: { readonly id: AchievementId }) {
  if (id === "earlyStart") {
    return (
      <g transform="translate(95 27)" className="omo3-art">
        <G at={80} o="c" tone="dawn">
          <circle className="omo3-body" r="6" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((turn) => (
            <path key={turn} className="omo3-ray omo3-fine" d="M0 -8.6V-10.8" transform={"rotate(" + turn + ")"} />
          ))}
        </G>
      </g>
    );
  }
  if (id === "nightOwl") {
    return (
      <g transform="translate(24 29)" className="omo3-art">
        <G at={80} o="c" tone="dawn">
          <path className="omo3-body" d="M3 -7.4A7.6 7.6 0 1 0 7.4 3.6A6.2 6.2 0 1 1 3 -7.4Z" />
          <circle className="omo3-body omo3-fine" cx="15" cy="-3" r="0.9" />
          <circle className="omo3-body omo3-fine" cx="8" cy="11" r="0.7" />
        </G>
      </g>
    );
  }
  return null;
}

/* ── Pots ───────────────────────────────────────────────────────────────── */

type Pot = {
  /** Where the plant stands. */
  readonly origin: number;
  readonly body: string;
  readonly rim?: readonly [number, number, number, number, number];
  readonly mound?: string;
  readonly feet?: readonly (readonly [number, number, number, number])[];
  readonly lines?: string;
  readonly band: readonly [number, number];
  readonly shadeX: number;
  /** Glass only: the lip [x, y, w, h], the highlight stroke and the water line. */
  readonly glass?: { readonly lip: readonly [number, number, number, number]; readonly hi: string; readonly water: number };
};

/** Pots and plants are drawn at full size, then pots shrink toward the ground line so the plant leads. */
const POT_K = 0.78;
const POT_T = "translate(60 110) scale(" + POT_K + ") translate(-60 -110)";

const PLANT_K: Record<AchievementId, number> = {
  firstFlow: 1.36, flow90: 1.1, flow180: 1.1, focusDay8h: 1.1,
  earlyStart: 1.15, nightOwl: 1.15, weekendShift: 1.08,
  streak7: 1.1, streak30: 1.08, focus100h: 1.24,
  driftDay: 1.1, noDriftDay: 1, comeback: 1.15,
};

const POTS: Record<AchievementGroup, Pot> = {
  focus: {
    origin: 67.4,
    body: "M43.6 77H76.4L72.6 105.4Q72.2 108.6 69 108.6H51Q47.8 108.6 47.4 105.4Z",
    rim: [41, 69, 38, 8.6, 2.2],
    mound: "M44 70.4Q60 63.6 76 70.4Z",
    band: [85, 4.4],
    shadeX: 66.5,
  },
  rhythm: {
    origin: 77,
    body: "M34 85H86C86 97.6 76.6 106 60 106C43.4 106 34 97.6 34 85Z",
    rim: [31.5, 79.6, 57, 6.4, 3.2],
    mound: "M34 80.4Q60 72.6 86 80.4Z",
    feet: [[51, 103.4, 18, 5.2]],
    band: [90, 4.2],
    shadeX: 70,
  },
  consistency: {
    origin: 75.6,
    body: "M40.5 84.4H79.5V104.2Q79.5 105.8 77.9 105.8H42.1Q40.5 105.8 40.5 104.2Z",
    rim: [37.5, 78, 45, 7.4, 1.6],
    mound: "M39 78.8Q60 72.2 81 78.8Z",
    feet: [[43, 104, 7, 5], [70, 104, 7, 5]],
    lines: "M40.5 91.6H79.5M40.5 98.8H79.5",
    band: [94.6, 3.6],
    shadeX: 68,
  },
  unexpected: {
    origin: 93.4,
    body: "M45 71H75C79.6 71 82 74 82 78.6V100.6C82 105 79 108.6 74 108.6H46C41 108.6 38 105 38 100.6V78.6C38 74 40.4 71 45 71Z",
    band: [71, 3.4],
    shadeX: 72,
    glass: { lip: [43, 65.6, 34, 5.8], hi: "M43.6 80V98", water: 75 },
  },
};

/** Within a group the pot changes shape too, so the silhouettes differ before the plants do. */
const POT_FOR: Partial<Record<AchievementId, Pot>> = {
  firstFlow: {
    origin: 80.8,
    body: "M44.5 89H75.5L73 105.6Q72.6 108.6 69.6 108.6H50.4Q47.4 108.6 47 105.6Z",
    rim: [42, 82, 36, 7, 2],
    mound: "M44.6 83.4Q60 77 75.4 83.4Z",
    band: [96, 4],
    shadeX: 66.5,
  },
  flow180: {
    origin: 63.4,
    body: "M47 71H73L71.2 105.4Q71 108.6 67.8 108.6H52.2Q49 108.6 48.8 105.4Z",
    rim: [45, 64, 30, 7, 2],
    mound: "M47.4 65.4Q60 59.6 72.6 65.4Z",
    band: [84, 4.2],
    shadeX: 65.6,
  },
  focusDay8h: {
    origin: 67.4,
    body: "M43.6 76.4H76.4C81.4 84 81.6 96 75.6 103.6Q72.6 108.6 66.6 108.6H53.4Q47.4 108.6 44.4 103.6C38.4 96 38.6 84 43.6 76.4Z",
    rim: [41.5, 69, 37, 7.4, 2.2],
    mound: "M43.6 70.4Q60 63.8 76.4 70.4Z",
    band: [88, 4.4],
    shadeX: 67,
  },
  focus100h: {
    origin: 92.8,
    body: "M33 99H87L84 106.4Q83.6 108.4 81.6 108.4H38.4Q36.4 108.4 36 106.4Z",
    rim: [30, 94, 60, 5, 1.6],
    mound: "M32 94.6Q60 88 88 94.6Z",
    feet: [[38, 106, 7, 3.4], [75, 106, 7, 3.4]],
    band: [101.4, 3],
    shadeX: 74,
  },
  noDriftDay: {
    origin: 77,
    body: "M42 72H78C86.6 76.8 90 86 87.4 95.4C85 103.6 77.6 108.6 68 108.6H52C42.4 108.6 35 103.6 32.6 95.4C30 86 33.4 76.8 42 72Z",
    band: [93, 3.6],
    shadeX: 72,
    glass: { lip: [40, 67, 40, 5.6], hi: "M37.6 86C37.4 92 39.6 98 43.6 102", water: 76.4 },
  },
};

function PotBack({ pot, clip, water }: { readonly pot: Pot; readonly clip: string; readonly water: boolean }) {
  if (pot.rim) return null;
  return (
    <g className="omo3-pot omo3-t-glass">
      <path className="omo3-glass" d={pot.body} />
      <g clipPath={"url(#" + clip + ")"}>
        {water ? (
          <g className="omo3-t-water">
            <rect className="omo3-body" x="28" y={pot.glass?.water} width="64" height="40" />
            <rect className="omo3-tint" x="28" y={pot.glass?.water} width="64" height="2.4" />
            <path className="omo3-line omo3-fine" d="M47 90H59M62 99.4H73" />
          </g>
        ) : (
          <g className="omo3-t-soil">
            <path className="omo3-body" d="M36 94.6Q60 90.4 84 94.6V110H36Z" />
            <circle className="omo3-tint omo3-fine" cx="47" cy="101" r="1.2" />
            <circle className="omo3-tint omo3-fine" cx="70" cy="104" r="1.5" />
            <circle className="omo3-tint omo3-fine" cx="59" cy="99" r="0.9" />
          </g>
        )}
      </g>
    </g>
  );
}

function PotFront({ group, pot, clip, banded }: { readonly group: AchievementGroup; readonly pot: Pot; readonly clip: string; readonly banded: boolean }) {
  if (!pot.rim) {
    return (
      <g className="omo3-pot omo3-t-glass">
        {banded ? (
          <g clipPath={"url(#" + clip + ")"}>
            <G at={1500} o="f" tone="gold"><rect className="omo3-body" x="30" y={pot.band[0]} width="60" height={pot.band[1]} /></G>
          </g>
        ) : null}
        <path className="omo3-glass-edge" d={pot.body} />
        <path className="omo3-glass-hi" d={pot.glass?.hi} />
        <rect className="omo3-lip" x={pot.glass?.lip[0]} y={pot.glass?.lip[1]} width={pot.glass?.lip[2]} height={pot.glass?.lip[3]} rx="2" />
      </g>
    );
  }
  const [x, y, w, h, rx] = pot.rim;
  return (
    <g className={"omo3-pot omo3-t-pot-" + group}>
      {pot.feet?.map(([fx, fy, fw, fh]) => <rect key={fx} className="omo3-tint" x={fx} y={fy} width={fw} height={fh} rx="1.2" />)}
      <path className="omo3-body" d={pot.body} />
      <g clipPath={"url(#" + clip + ")"}>
        <rect className="omo3-tint" x={pot.shadeX} y="50" width="40" height="65" />
        {banded ? <G at={1500} o="f" tone="gold"><rect className="omo3-body" x="20" y={pot.band[0]} width="80" height={pot.band[1]} /></G> : null}
      </g>
      {pot.lines ? <path className="omo3-line omo3-fine" d={pot.lines} /> : null}
      <rect className="omo3-body" x={x} y={y} width={w} height={h} rx={rx} />
      <rect className="omo3-tint" x={x + w - (x + w - pot.shadeX) - 2} y={y} width={x + w - pot.shadeX + 2} height={h} rx={rx} />
      <path className="omo3-hi omo3-fine" d={p`M${x + rx + 1} ${y + 1.4}H${pot.shadeX - 4}V${y + 2.6}H${x + rx + 1}Z`} />
      {pot.mound ? <path className="omo3-body omo3-t-soil" d={pot.mound} /> : null}
    </g>
  );
}

/** A pot under a frosted bell jar: something grows here, unseen. */
function Covered() {
  const pot = POTS.focus;
  return (
    <>
      <g className="omo3-t-pot-hidden">
        <path className="omo3-body" d={pot.body} />
        <path className="omo3-tint" d="M66.5 77H76.4L72.6 105.4Q72.2 108.6 69 108.6H63.8Z" />
        <rect className="omo3-body" x="41" y="69" width="38" height="8.6" rx="2.2" />
      </g>
      <g className="omo3-t-frost">
        <path className="omo3-frost" d="M33.4 106V70C33.4 50 44.6 38.4 60 38.4C75.4 38.4 86.6 50 86.6 70V106Z" />
        <path className="omo3-frost-edge" d="M33.4 106V70C33.4 50 44.6 38.4 60 38.4C75.4 38.4 86.6 50 86.6 70V106" />
        <path className="omo3-glass-hi" d="M39.8 92V70.6C39.8 59 43.6 51.4 49.6 46.6" />
        <rect className="omo3-body" x="57.8" y="32.6" width="4.4" height="7" rx="1.4" />
        <circle className="omo3-body" cx="60" cy="31.6" r="4.4" />
        <rect className="omo3-body" x="30.6" y="104.4" width="58.8" height="5" rx="2.2" />
        <rect className="omo3-tint" x="74" y="104.4" width="15.4" height="5" rx="2.2" />
      </g>
    </>
  );
}

/** omo 3, 화분: a potted plant per achievement that grows with each milestone. */
export function AchievementOmo3({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const clip = "omo3-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const stage = state === "earned" ? (tier > 0 ? Math.min(6, tier) : 6) : 4;
  const moving = entrance && state === "earned";
  const pot = POT_FOR[id] ?? POTS[group];
  const plant = PLANTS[id];

  return (
    <Motion.Provider value={moving}>
      <svg
        className="omo3"
        viewBox={detail ? "0 0 120 120" : "8 8 104 104"}
        aria-hidden="true"
        focusable="false"
        data-id={id}
        data-group={group}
        data-state={state}
        data-stage={stage}
        data-detail={detail ? "true" : "false"}
        data-entrance={moving ? "true" : undefined}
      >
        <defs>
          <clipPath id={clip}>
            <path d={state === "concealed" ? POTS.focus.body : pot.body} />
          </clipPath>
        </defs>
        <circle className="omo3-disc" cx="60" cy="60" r="54" />
        {state === "earned" && stage === 6 ? <circle className="omo3-crown" cx="60" cy="60" r="51.6" /> : null}
        <ellipse className="omo3-ground" cx="60" cy="109.6" rx={state === "concealed" ? 25 : 21} ry="2.4" />
        {state === "concealed" ? (
          <Covered />
        ) : (
          <>
            <Sky id={id} />
            <g transform={POT_T}><PotBack pot={pot} clip={clip} water={id === "noDriftDay"} /></g>
            <g transform={p`translate(60 ${110 - (110 - pot.origin) * POT_K}) scale(${PLANT_K[id]})`}>
              <g className="omo3-art omo3-sway">{plant(stage)}</g>
            </g>
            <g transform={POT_T}><PotFront group={group} pot={pot} clip={clip} banded={state === "earned" && stage === 6} /></g>
          </>
        )}
      </svg>
    </Motion.Provider>
  );
}
