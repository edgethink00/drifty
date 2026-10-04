/** Lucide paths (ISC license, lucide.dev) shared by the Memory surface. */
type IconName = "thumbsUp" | "thumbsDown" | "chevronDown" | "check";

const PATHS: Record<IconName, readonly string[]> = {
  thumbsUp: ["M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z", "M7 10v12"],
  thumbsDown: ["M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z", "M17 14V2"],
  chevronDown: ["m6 9 6 6 6-6"],
  check: ["M20 6 9 17l-5-5"],
};

export function MemoryIcon({ name, size = 16, filled = false }: { readonly name: IconName; readonly size?: number; readonly filled?: boolean }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"
    fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.18 : undefined}
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {PATHS[name].map((d) => <path key={d} d={d} />)}
  </svg>;
}

