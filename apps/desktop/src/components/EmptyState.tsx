import type { ReactNode } from "react";

export function EmptyState({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="eyebrow">{title}</span>
      <strong>Not enough data yet</strong>
      <p>{detail}</p>
      {children}
    </div>
  );
}
