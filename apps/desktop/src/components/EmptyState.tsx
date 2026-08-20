import type { ReactNode } from "react";

export function EmptyState({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
      {children}
    </div>
  );
}
