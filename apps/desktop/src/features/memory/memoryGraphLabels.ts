type Bounds = { x: number; y: number; width: number; height: number };
type Candidate = {
  id: string;
  title: string;
  x: number;
  y: number;
  radius: number;
  priority: number;
  important: boolean;
  retain: boolean;
  eligible: boolean;
};

type GraphLabel = {
  text: string;
  dx: number;
  dy: number;
  anchor: "start" | "middle" | "end";
};

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Work in screen coordinates so a camera move cannot magnify a label into its neighbour. */
export function placeGraphLabels(candidates: readonly Candidate[], region: Bounds, fontSize: number, measure: (text: string) => number, limit: number) {
  const shown = new Map<string, GraphLabel>();
  const occupied: Bounds[] = [];
  for (const node of candidates.filter((node) => node.eligible).sort((a, b) => b.priority - a.priority)) {
    if (shown.size >= limit) break;
    const margin = node.radius + 5;
    const centered = 2 * Math.min(node.x - region.x - 8, region.x + region.width - node.x - 8);
    const placements = [
      { dx: 0, dy: margin + fontSize, anchor: "middle", space: centered },
      { dx: 0, dy: -margin, anchor: "middle", space: centered },
      { dx: margin, dy: fontSize / 3, anchor: "start", space: region.x + region.width - node.x - margin - 8 },
      { dx: -margin, dy: fontSize / 3, anchor: "end", space: node.x - region.x - margin - 8 },
    ] as const;
    let fallback: { label: GraphLabel; box: Bounds; collisions: number } | undefined;
    for (const { dx, dy, anchor, space } of node.important ? placements : placements.slice(0, 1)) {
      const available = Math.min(node.important ? 248 : 195, space);
      if (available < 36) continue;
      let text = node.title;
      if (measure(text) > available) {
        const characters = Array.from(text);
        while (characters.length && measure(characters.join("") + "…") > available) characters.pop();
        text = characters.join("").trimEnd() + "…";
      }
      const width = measure(text);
      const left = anchor === "middle" ? width / 2 : anchor === "end" ? width : 0;
      const box = { x: node.x + dx - left - 6, y: node.y + dy - fontSize - 3, width: width + 12, height: fontSize + 9 };
      if (box.y < region.y || box.y + box.height > region.y + region.height || occupied.some((other) => overlaps(box, other))) continue;
      const label = { text, dx, dy, anchor };
      let collisions = 0;
      for (const other of candidates) {
        if (other.id === node.id) continue;
        if (overlaps(box, { x: other.x - other.radius, y: other.y - other.radius, width: other.radius * 2, height: other.radius * 2 })) {
          collisions += 1;
          if (!node.retain) break;
        }
      }
      if (collisions) {
        // Keep the current page and dense hubs identifiable when all placements touch a dot.
        if (node.retain && (!fallback || collisions < fallback.collisions)) fallback = { label, box, collisions };
        continue;
      }
      shown.set(node.id, label);
      occupied.push(box);
      break;
    }
    if (!shown.has(node.id) && fallback) {
      shown.set(node.id, fallback.label);
      occupied.push(fallback.box);
    }
  }
  return shown;
}
