export function DeferredPageImportFallback({ label }: { readonly label: string }) {
  return (
    <section
      className="page page--loading-skeleton deferred-page-import"
      role="status"
      aria-live="polite"
      aria-label={`Loading ${label}`}
    >
      <div className="empty-state">
        <strong>Loading {label}...</strong>
      </div>
    </section>
  );
}
