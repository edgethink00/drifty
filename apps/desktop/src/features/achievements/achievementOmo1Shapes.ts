/** Geometry for omo 1 (the record as the badge). Angles run clockwise from twelve o'clock. */

const round = (value: number) => Math.round(value * 100) / 100;

export function polar(cx: number, cy: number, r: number, degrees: number): readonly [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [round(cx + r * Math.sin(radians)), round(cy - r * Math.cos(radians))];
}

/** A continuous-corner square (superellipse), the shape of a widget plate. */
export function squirclePath(cx: number, cy: number, half: number, exponent = 5, steps = 120): string {
  const points: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const t = (index / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + half * Math.sign(c) * Math.abs(c) ** (2 / exponent);
    const y = cy + half * Math.sign(s) * Math.abs(s) ** (2 / exponent);
    points.push(round(x) + " " + round(y));
  }
  return "M" + points.join("L") + "Z";
}

/** An arc from one angle to another; a sweep of 360 or more is a whole lap that ends where it began. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const sweep = to - from;
  const start = polar(cx, cy, r, from);
  if (sweep >= 360) {
    const half = polar(cx, cy, r, from + 180);
    return `M${start[0]} ${start[1]}A${r} ${r} 0 0 1 ${half[0]} ${half[1]}A${r} ${r} 0 0 1 ${start[0]} ${start[1]}`;
  }
  const end = polar(cx, cy, r, to);
  return `M${start[0]} ${start[1]}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${end[0]} ${end[1]}`;
}

/** A crescent: the disc at (cx, cy) with a smaller disc, moved by (dx, dy), taken out of it. */
export function crescentPath(cx: number, cy: number, outer: number, dx: number, dy: number, inner: number): string {
  const distance = Math.hypot(dx, dy);
  const along = (outer * outer - inner * inner + distance * distance) / (2 * distance);
  const across = Math.sqrt(Math.max(0, outer * outer - along * along));
  const ux = dx / distance;
  const uy = dy / distance;
  const px = cx + along * ux;
  const py = cy + along * uy;
  const a = [round(px - across * uy), round(py + across * ux)];
  const b = [round(px + across * uy), round(py - across * ux)];
  return `M${a[0]} ${a[1]}A${outer} ${outer} 0 1 1 ${b[0]} ${b[1]}A${inner} ${inner} 0 0 0 ${a[0]} ${a[1]}Z`;
}
