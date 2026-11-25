import type { MemoryWikiPage } from "../screen-context/memoryWire";
import type { GraphPoint } from "./memoryGraphLayout";
import { linkedPageIds, type WikiLink } from "./memoryWikiModel";

export type GraphReview = {
  readonly variant: "before" | "overview" | "neighborhood" | "types";
  readonly depth: 1 | 2;
  readonly kind: "all" | MemoryWikiPage["kind"];
};

export function reviewSubgraph(pages: readonly MemoryWikiPage[], links: readonly WikiLink[], review: GraphReview | undefined, selectedId: string | null) {
  let visible: Set<string>;
  if (review?.variant === "neighborhood" && selectedId) {
    visible = new Set([selectedId]);
    let frontier = [selectedId];
    for (let hop = 0; hop < review.depth; hop += 1) {
      frontier = [...new Set(frontier.flatMap((id) => linkedPageIds(id, links)))].filter((id) => !visible.has(id));
      frontier.forEach((id) => visible.add(id));
    }
  } else if (review?.variant === "types" && review.kind !== "all") {
    // Keep the open page visible when following a link across kinds.
    visible = new Set(pages.filter((page) => page.kind === review.kind || page.id === selectedId).map((page) => page.id));
  } else {
    return { pages, links };
  }
  return { pages: pages.filter((page) => visible.has(page.id)), links: links.filter((link) => visible.has(link.source) && visible.has(link.target)) };
}

/** Place direct neighbors around the selected page and second-hop pages on the outer ring. */
export function reviewNeighborhoodLayout(ids: readonly string[], links: readonly WikiLink[], selectedId: string, width: number, height: number) {
  const center = { x: width / 2, y: height / 2 };
  const positions = new Map<string, GraphPoint>([[selectedId, center]]);
  const direct = new Set(linkedPageIds(selectedId, links));
  const rings = [ids.filter((id) => direct.has(id)), ids.filter((id) => id !== selectedId && !direct.has(id))];
  rings.forEach((ring, depth) => {
    const radius = (depth + 1) * 137;
    ring.forEach((id, index) => {
      const angle = -Math.PI / 2 + (index + depth / 2) * 2 * Math.PI / ring.length;
      positions.set(id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    });
  });
  return positions;
}

type Bounds = { x: number; y: number; width: number; height: number };
type Candidate = { id: string; title: string; x: number; y: number; radius: number; priority: number; important: boolean; eligible: boolean };

export function reviewLabels(candidates: readonly Candidate[], region: Bounds, fontSize: number, measure: (text: string) => number, limit: number) {
  const shown = new Map<string, string>();
  const occupied: Bounds[] = [];
  for (const node of candidates.filter((node) => node.eligible).sort((a, b) => b.priority - a.priority)) {
    if (shown.size >= limit) break;
    const available = Math.min(node.important ? 248 : 195, 2 * Math.min(node.x - region.x - 8, region.x + region.width - node.x - 8));
    if (available < 36) continue;
    let label = node.title;
    if (measure(label) > available) {
      const characters = Array.from(label);
      while (characters.length && measure(characters.join("") + "…") > available) characters.pop();
      label = characters.join("").trimEnd() + "…";
    }
    const width = measure(label) + 12;
    const box = { x: node.x - width / 2, y: node.y + node.radius + 2, width, height: fontSize + 9 };
    if (box.y < region.y || box.y + box.height > region.y + region.height) continue;
    if (occupied.some((other) => box.x < other.x + other.width && box.x + box.width > other.x
      && box.y < other.y + other.height && box.y + box.height > other.y)) continue;
    if (candidates.some((other) => other.id !== node.id
      && Math.abs(other.x - box.x - box.width / 2) < box.width / 2 + other.radius
      && Math.abs(other.y - box.y - box.height / 2) < box.height / 2 + other.radius)) continue;
    occupied.push(box);
    shown.set(node.id, label);
  }
  return shown;
}
