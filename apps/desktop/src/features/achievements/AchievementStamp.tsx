import { useId } from "react";
import { ACHIEVEMENT_GLYPH_PATHS } from "./AchievementGlyph";
import type { AchievementArtProps } from "./achievementArt";

const SHEET = { x: 10, y: 6, width: 70, height: 88 } as const;
const FIELD = { x: 16, y: 12, width: 58, height: 76 } as const;

/** A rectangle with a row of round bites along every side, as a stamp torn from its sheet has. */
function perforated(across: number, down: number, bite: number): string {
  const { x, y, width, height } = SHEET;
  const stepX = width / across;
  const stepY = height / down;
  const arc = "A" + bite + " " + bite + " 0 0 0 ";
  let path = "M" + x + " " + y;
  for (let index = 0; index < across; index += 1) {
    const centre = x + stepX * (index + 0.5);
    path += "H" + (centre - bite).toFixed(2) + arc + (centre + bite).toFixed(2) + " " + y;
  }
  path += "H" + (x + width);
  for (let index = 0; index < down; index += 1) {
    const centre = y + stepY * (index + 0.5);
    path += "V" + (centre - bite).toFixed(2) + arc + (x + width) + " " + (centre + bite).toFixed(2);
  }
  path += "V" + (y + height);
  for (let index = 0; index < across; index += 1) {
    const centre = x + width - stepX * (index + 0.5);
    path += "H" + (centre + bite).toFixed(2) + arc + (centre - bite).toFixed(2) + " " + (y + height);
  }
  path += "H" + x;
  for (let index = 0; index < down; index += 1) {
    const centre = y + height - stepY * (index + 0.5);
    path += "V" + (centre + bite).toFixed(2) + arc + x + " " + (centre - bite).toFixed(2);
  }
  return path + "Z";
}

const SHEET_PATH = perforated(9, 11, 2.1);

/** A postage stamp: its mark engraved on a tinted field, its figure as the face value, and a postmark with the day once earned. */
export function AchievementStamp({ id, group, state, detail, mark, day }: AchievementArtProps) {
  const hatchId = "stamp-hatch-" + useId().replace(/:/gu, "");
  const earned = state === "earned";
  const glyph = ACHIEVEMENT_GLYPH_PATHS[state === "concealed" ? "hidden" : id];
  const valueSize = mark.text.length + (mark.unit ? 0.5 : 0) > 3 ? 10.5 : 13.5;
  return (
    <svg className="achievement-art achievement-stamp" viewBox="0 0 100 100" data-group={group} data-state={state} aria-hidden="true" focusable="false">
      <g transform="translate(2.5 0)">
      {earned ? (
        <>
          <defs>
            <pattern id={hatchId} width="4" height="2.1" patternUnits="userSpaceOnUse">
              <path className="achievement-stamp__hatch" d="M0 1.05H4" />
            </pattern>
          </defs>
          <path className="achievement-stamp__paper" d={SHEET_PATH} />
          <rect className="achievement-stamp__field" {...FIELD} />
          {detail ? <rect {...FIELD} fill={"url(#" + hatchId + ")"} /> : null}
          <rect className="achievement-stamp__frame" {...FIELD} />
        </>
      ) : (
        <path className="achievement-stamp__slot" d={SHEET_PATH} />
      )}
      <g className="achievement-stamp__glyph" transform={detail ? "translate(45 47.5) scale(1.72) translate(-12 -12)" : "translate(45 50) scale(1.9) translate(-12 -12)"}>
        {glyph.map((d) => <path key={d} d={d} />)}
      </g>
      {detail ? (
        <>
          {/* The wordmark is always Latin capitals, so its spacing is fixed in the drawing. */}
          <text className="achievement-stamp__brand" x="20.5" y="20.6" fontSize="4.1" letterSpacing="1">DRIFTY</text>
          <text className="achievement-stamp__value" x="20.2" y="83.6" fontSize={valueSize}>
            {mark.text}
            {mark.unit ? <tspan fontSize={valueSize * 0.55} dx="0.4">{mark.unit}</tspan> : null}
          </text>
        </>
      ) : null}
      {earned && detail ? (
        <g className="achievement-stamp__postmark" transform="translate(78 21) rotate(-13)">
          <circle r="12.6" />
          <circle r="9.4" className="achievement-stamp__postmark-inner" />
          <path d="M-6 -4.2H6M-6 4.4H6" className="achievement-stamp__postmark-inner" />
          {day ? <text className="achievement-stamp__postmark-day" y="1.9" fontSize="5.1" textAnchor="middle">{day}</text> : null}
        </g>
      ) : null}
      </g>
    </svg>
  );
}
