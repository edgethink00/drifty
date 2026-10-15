import type { ReactNode } from "react";

/**
 * Line icons for the category editor and the buttons that open it, drawn on
 * the same 24-unit grid and 1.8 stroke as the main navigation and the settings
 * rail so they read as one icon set. Shapes follow Lucide.
 */
function LineIcon({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <svg className={"definition-icon" + (className ? " " + className : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Productivity: a gauge. */
export function ProductivityIcon() {
  return <LineIcon><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></LineIcon>;
}

/** Categories: the settings rail's tag. */
export function CategoryIcon() {
  return <LineIcon><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></LineIcon>;
}

/** Projects: the main navigation's stacked layers. */
export function ProjectIcon() {
  return <LineIcon><path d="M12 5 3 10l9 5 9-5-9-5Z" /><path d="M3 15l9 5 9-5" /><path d="M3 10v5m18-5v5" /></LineIcon>;
}

/** App and site rules: a checked list. */
export function RulesIcon() {
  return <LineIcon><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></LineIcon>;
}

/** Edit: the filled pencil, the same glyph the plate pencils carry. */
export function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={"definition-icon definition-icon--filled" + (className ? " " + className : "")} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 17.2V21h3.8L17.8 9.9l-3.8-3.8L3 17.2Zm17.7-10.2a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8 1.7-1.9Z" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return <LineIcon><path d="m9 18 6-6-6-6" /></LineIcon>;
}

export function PlusIcon() {
  return <LineIcon><path d="M5 12h14" /><path d="M12 5v14" /></LineIcon>;
}

export function LockIcon() {
  return <LineIcon><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></LineIcon>;
}

export function ResetIcon() {
  return <LineIcon><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></LineIcon>;
}

export function ArchiveIcon() {
  return <LineIcon><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></LineIcon>;
}

export function UnarchiveIcon() {
  return <LineIcon><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h2" /><path d="M20 8v11a2 2 0 0 1-2 2h-2" /><path d="m9 15 3-3 3 3" /><path d="M12 12v9" /></LineIcon>;
}

export function TrashIcon() {
  return <LineIcon><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></LineIcon>;
}
