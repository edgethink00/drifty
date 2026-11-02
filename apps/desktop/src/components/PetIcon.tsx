/**
 * The pet paw, drawn as an outline at the stroke weight of the list it sits in
 * (Settings rail 1.8, account menu 1.6). It replaces a filled Phosphor glyph
 * whose 1px-equivalent strokes read lighter than every neighbouring icon.
 */
export function PetIcon({ strokeWidth = 1.8 }: { readonly strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <circle cx="5" cy="10.1" r="1.7" />
      <circle cx="9" cy="5.7" r="1.9" />
      <circle cx="15" cy="5.7" r="1.9" />
      <circle cx="19" cy="10.1" r="1.7" />
      <path d="M12 11.9c-1.7 0-2.8 1.3-3.6 2.6-.5.8-1.2 1.3-1.8 1.8a2.4 2.4 0 0 0 2.2 4.1c1.1-.2 2-.6 3.2-.6s2.1.4 3.2.6a2.4 2.4 0 0 0 2.2-4.1c-.6-.5-1.3-1-1.8-1.8-.8-1.3-1.9-2.6-3.6-2.6Z" />
    </svg>
  );
}
