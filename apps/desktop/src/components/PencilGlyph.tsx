import "./pencil-plate.css";

/**
 * The filled pencil used on every plate-style edit button. A solid glyph
 * reads at 11–12px where a stroked outline turns to fuzz; the plate around it
 * (see pencil-plate.css) is what makes the control look like one thing
 * across the legend, the activity rows, and the pickers.
 */
export function PencilGlyph({ className }: { readonly className?: string }) {
  return (
    <svg className={"pencil-glyph" + (className ? " " + className : "")} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 17.2V21h3.8L17.8 9.9l-3.8-3.8L3 17.2Zm17.7-10.2a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8 1.7-1.9Z" />
    </svg>
  );
}
