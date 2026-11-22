import type { AchievementId } from "./achievementCatalog";

export type AchievementGlyphName = AchievementId | "hidden" | "lock";

/** Line marks drawn for Drifty's achievements; 24 × 24, stroked in the current colour. */
export const ACHIEVEMENT_GLYPH_PATHS: Record<AchievementGlyphName, readonly string[]> = {
  firstFlow: ["M12 20v-7", "M12 13c0-3.3 2.2-5.5 5.5-5.5 0 3.3-2.2 5.5-5.5 5.5Z", "M12 15c0-2.8-1.9-4.6-4.8-4.6 0 2.8 1.9 4.6 4.8 4.6Z"],
  flow90: ["M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z", "M12 13.5V9.5", "M10 3h4"],
  flow180: ["M3 19 9 9l4 6 2-3 6 7H3Z"],
  focusDay8h: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 3v2", "M12 19v2", "M3 12h2", "M19 12h2", "m5.6 5.6 1.4 1.4", "m17 17 1.4 1.4", "m5.6 18.4 1.4-1.4", "m17 7 1.4-1.4"],
  earlyStart: ["M4 18h16", "M7 18a5 5 0 0 1 10 0", "M12 6v3", "m5.5 11.5 1.4 1.4", "m18.5 11.5-1.4 1.4"],
  nightOwl: ["M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10Z"],
  weekendShift: ["M4 8h16v11H4Z", "M9 8V5.5h6V8", "M4 13h16"],
  streak7: ["M5 5h14v15H5Z", "M9 3v4", "M15 3v4", "M5 10h14", "m9 15 2 2 4-4"],
  streak30: ["M5 5h14v15H5Z", "M9 3v4", "M15 3v4", "M5 10h14", "M9 14h.01", "M12 14h.01", "M15 14h.01", "M9 17h.01", "M12 17h.01"],
  focus100h: ["M7 4h10l3.5 5L12 20 3.5 9 7 4Z", "M3.5 9h17", "m9.5 4 2.5 16 2.5-16"],
  driftDay: ["M3 8c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0", "M3 13c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0", "M3 18c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"],
  noDriftDay: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 12h.01"],
  comeback: ["m4 16 5-5 4 4 7-7", "M15 8h5v5"],
  hidden: ["M9.5 9.2a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.1.9-1.1 1.6v.4", "M12 17h.01"],
  lock: ["M7 11h10v9H7Z", "M9.5 11V8.5a2.5 2.5 0 0 1 5 0V11"],
};

export function AchievementGlyph({ name, className }: { readonly name: AchievementGlyphName; readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ACHIEVEMENT_GLYPH_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

