import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const APP_COLORS = [
  ["Visual Studio Code", "#3b82f6"],
  ["Safari", "#06b6d4"],
  ["Google Chrome", "#22c55e"],
  ["Arc", "#f97316"],
  ["Terminal", "#94a3b8"],
  ["Finder", "#60a5fa"],
];

function colorForApp(appName: string) {
  const found = APP_COLORS.find(([name]) => appName.includes(name));
  if (found) return found[1];

  let hash = 0;
  for (const char of appName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 70% 56%)`;
}

function initials(appName: string) {
  return appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppGlyph({
  appName,
  size = "md",
  iconSrc,
}: {
  appName: string;
  size?: "sm" | "md" | "lg";
  iconSrc?: string | null;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const style = { ["--app-glyph-color" as const]: colorForApp(appName) } as CSSProperties;

  useEffect(() => {
    setIconFailed(false);
  }, [iconSrc]);

  if (iconSrc && !iconFailed) {
    return (
      <img
        className={`app-icon app-icon--${size}`}
        src={iconSrc}
        alt=""
        aria-hidden="true"
        onError={() => setIconFailed(true)}
      />
    );
  }

  return (
    <div className={`app-glyph app-glyph--${size}`} style={style} aria-hidden="true">
      <span>{initials(appName)}</span>
    </div>
  );
}
