export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="eyebrow">{title}</span>
      <strong>Not enough data yet</strong>
      <p>{detail}</p>
    </div>
  );
}
