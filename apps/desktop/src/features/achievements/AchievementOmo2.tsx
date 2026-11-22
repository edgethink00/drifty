import { useId } from "react";
import type { AchievementArtProps } from "./achievementArt";
import { ACHIEVEMENT_DEFINITIONS } from "./achievementCatalog";
import { OMO2_BAR, OMO2_PINS, OMO2_STUD_X, packetPath, star, type Omo2Pin, type Omo2Tone } from "./achievementOmo2Shapes";
import "./achievementOmo2.css";

const LINE = 2.4;
const QUESTION = "M52 49C52 43.5 55.8 40 60.5 40C65.5 40 69 43.5 69 48C69 52.5 66 54.5 63 56.5C61 58 60.2 59.5 60.2 63";

function Parts({ pin, className, transform }: { readonly pin: Omo2Pin; readonly className: string; readonly transform?: string }) {
  return (
    <g className={className} transform={transform}>
      {pin.parts.map((d, i) => <path key={i} d={d} />)}
    </g>
  );
}

function tone(name: Omo2Tone) {
  return "omo2-e omo2-e--" + name;
}

/** A raised metal line: a dark lower edge, the metal face, and a thin lit top edge. */
function Line({ d, w = LINE }: { readonly d: string; readonly w?: number }) {
  return (
    <>
      <path className="omo2-line omo2-line--shade" d={d} strokeWidth={w + 0.2} transform="translate(0.3 0.4)" />
      <path className="omo2-line omo2-line--face" d={d} strokeWidth={w} />
      <path className="omo2-line omo2-line--hi" d={d} strokeWidth={Math.max(0.6, w * 0.24)} transform="translate(-0.3 -0.4)" />
    </>
  );
}

function Glint({ x, y, s }: { readonly x: number; readonly y: number; readonly s: number }) {
  return <path className="omo2-glint" d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`} />;
}

function Pin({ pin, uid, earned, top }: { readonly pin: Omo2Pin; readonly uid: string; readonly earned: boolean; readonly top: boolean }) {
  const cut = `url(#${uid}-cut)`;
  const wires = pin.wires ?? [];
  return (
    <>
      {earned ? (
        <g className="omo2-shadow" filter={`url(#${uid}-blur)`}>
          <g transform="translate(0 2.6)">
            {pin.parts.map((d, i) => <path key={i} d={d} />)}
            {wires.map((wire, i) => <path key={"w" + i} className="omo2-shadow__wire" d={wire.d} strokeWidth={(wire.w ?? LINE) + 0.8} />)}
          </g>
        </g>
      ) : null}
      <g className="omo2-pin">
        <Parts pin={pin} className="omo2-edge" />
        {wires.map((wire, i) => <path key={i} className="omo2-edge omo2-edge--wire" d={wire.d} strokeWidth={(wire.w ?? LINE) + 0.8} />)}
        <g clipPath={cut}>
          <Parts pin={pin} className="omo2-rim omo2-rim--hi" />
          <Parts pin={pin} className="omo2-rim omo2-rim--shade" transform="translate(0.5 0.6)" />
          <g transform="translate(0.5 0.6)" clipPath={cut}>
            <Parts pin={pin} className="omo2-rim omo2-rim--face" transform="translate(-1 -1.2)" />
          </g>
        </g>
        {pin.fields.map((field, i) => <path key={i} className={tone(field.tone)} d={field.d} />)}
        {pin.fields.map((field, i) => <Line key={i} d={field.d} />)}
        {wires.map((wire, i) => <Line key={"w" + i} d={wire.d} w={wire.w} />)}
        {earned ? <Glint x={pin.glint[0]} y={pin.glint[1]} s={3.4} /> : null}
        {earned && top ? (
          <g className="omo2-star">
            <path className="omo2-star__edge" d={star(pin.star[0], pin.star[1], 5, 7.6, 3.4)} />
            <path className="omo2-star__face" d={star(pin.star[0], pin.star[1], 5, 6.2, 2.7)} />
          </g>
        ) : null}
        {earned ? (
          <g clipPath={cut}>
            <g transform="skewX(-18)">
              <rect className="omo2-sweep" x={-46} y={-10} width={36} height={130} fill={`url(#${uid}-sweep)`} />
            </g>
          </g>
        ) : null}
      </g>
    </>
  );
}

function Bar({ tier, tone: main }: { readonly tier: number; readonly tone: Omo2Tone }) {
  const { x, y, w, h } = OMO2_BAR;
  const r = h / 2;
  return (
    <g className="omo2-bar">
      <rect className="omo2-bar__body" x={x} y={y} width={w} height={h} rx={r} />
      {OMO2_STUD_X.map((cx, i) => (
        i < tier ? (
          <g key={i} className="omo2-stud" style={{ animationDelay: 1300 + i * 70 + "ms" }}>
            <circle className="omo2-stud__rim" cx={cx} cy={y + r} r={3.1} />
            <circle className={tone(main)} cx={cx} cy={y + r} r={2.5} />
            <circle className="omo2-stud__hi" cx={cx - 0.8} cy={y + r - 0.9} r={0.6} />
          </g>
        ) : <circle key={i} className="omo2-socket" cx={cx} cy={y + r} r={1.3} />
      ))}
    </g>
  );
}

function Packet({ uid, detail }: { readonly uid: string; readonly detail: boolean }) {
  const d = packetPath();
  const clip = `url(#${uid}-packet)`;
  return (
    <g className="omo2-packet" transform="rotate(-4 60 60)">
      {detail ? <path className="omo2-packet__shadow" d={d} transform="translate(0 2.5)" filter={`url(#${uid}-blur)`} /> : null}
      <path className="omo2-packet__foil" d={d} />
      <g clipPath={clip}>
        <rect className="omo2-packet__seal" x={30} y={12} width={60} height={15} />
        <rect className="omo2-packet__seal" x={30} y={93} width={60} height={15} />
        {detail ? (
          <>
            {Array.from({ length: 20 }, (_, i) => 36.25 + i * 2.5).map((cx) => (
              <path key={cx} className="omo2-packet__crimp" d={`M${cx} 19.5V26M${cx} 94V100.5`} />
            ))}
            <rect x={20} y={0} width={80} height={120} fill={`url(#${uid}-foil)`} />
          </>
        ) : null}
      </g>
      <path className="omo2-packet__edge" d={d} />
      <g className="omo2-question" transform={detail ? undefined : "translate(-18 -20) scale(1.3)"}>
        {detail ? (
          <>
            <path className="omo2-question__shade" d={QUESTION} transform="translate(0.8 1)" />
            <circle className="omo2-question__dot omo2-question__dot--shade" cx={60.9} cy={73} r={3} />
            <path className="omo2-question__hi" d={QUESTION} transform="translate(-0.7 -0.9)" />
            <circle className="omo2-question__dot omo2-question__dot--hi" cx={59.5} cy={71.1} r={3} />
          </>
        ) : null}
        <path className="omo2-question__face" d={QUESTION} />
        <circle className="omo2-question__dot" cx={60.2} cy={72} r={3} />
      </g>
    </g>
  );
}

function Compact({ pin, earned }: { readonly pin: Omo2Pin; readonly earned: boolean }) {
  const wires = pin.wires ?? [];
  return (
    <g className={earned ? "omo2-compact" : "omo2-compact omo2-compact--blank"}>
      <Parts pin={pin} className="omo2-compact__edge" />
      {wires.map((wire, i) => <path key={i} className="omo2-compact__wire-edge" d={wire.d} strokeWidth={(wire.w ?? LINE) + 5} />)}
      <Parts pin={pin} className="omo2-compact__face" />
      {earned ? pin.compact.map((index) => <path key={index} className={tone(pin.fields[index].tone) + " omo2-compact__field"} d={pin.fields[index].d} />) : null}
    </g>
  );
}

/** omo 2, enamel pins: each achievement is a die-cut hard-enamel lapel pin whose outline is the object itself. */
export function AchievementOmo2({ id, group, state, detail, tier, entrance = false }: AchievementArtProps) {
  const uid = "omo2" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pin = OMO2_PINS[id];
  const repeatable = ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === id)?.repeatable ?? false;
  const earned = state === "earned";
  const gilded = earned && (!repeatable || tier >= 4);
  const hasBar = repeatable && state !== "concealed";
  const moving = earned && detail && entrance;
  const seat = hasBar ? 95.5 - 0.9 * pin.box[1] : 60 - 0.45 * (pin.box[0] + pin.box[1]);

  const viewBox = !detail ? (state === "concealed" ? "14 12 92 96" : "-4 -4 108 108") : "0 0 120 120";

  return (
    <svg
      className="omo2"
      viewBox={viewBox}
      data-id={id}
      data-group={group}
      data-state={state}
      data-tier={tier}
      data-gilded={gilded ? "true" : "false"}
      data-detail={detail ? "true" : "false"}
      data-entrance={moving ? "true" : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={`${uid}-blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
        <clipPath id={`${uid}-cut`}>
          {pin.parts.map((d, i) => <path key={i} d={d} />)}
        </clipPath>
        <clipPath id={`${uid}-packet`}>
          <path d={packetPath()} />
        </clipPath>
        <linearGradient id={`${uid}-sweep`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" className="omo2-stop omo2-stop--clear" />
          <stop offset="0.5" className="omo2-stop omo2-stop--light" />
          <stop offset="1" className="omo2-stop omo2-stop--clear" />
        </linearGradient>
        <linearGradient id={`${uid}-foil`} x1="0" x2="1" y1="0" y2="0.35">
          <stop offset="0" className="omo2-stop omo2-stop--sheen" />
          <stop offset="0.32" className="omo2-stop omo2-stop--clear" />
          <stop offset="0.55" className="omo2-stop omo2-stop--sheen" />
          <stop offset="0.7" className="omo2-stop omo2-stop--clear" />
          <stop offset="1" className="omo2-stop omo2-stop--dim" />
        </linearGradient>
      </defs>
      {state === "concealed" ? (
        <Packet uid={uid} detail={detail} />
      ) : !detail ? (
        <Compact pin={pin} earned={earned} />
      ) : (
        <>
          <g transform={`translate(15 ${seat}) scale(0.9)`}>
            <Pin pin={pin} uid={uid} earned={earned} top={earned && tier >= 6} />
          </g>
          {hasBar ? <Bar tier={earned ? tier : 0} tone={pin.main} /> : null}
        </>
      )}
    </svg>
  );
}
