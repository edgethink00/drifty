import { PencilGlyph } from "../../components/PencilGlyph";
import "./categoryEditor.css";

/**
 * The plate pencil that opens the category editor next to a legend or a
 * picker — the same door wherever a definition shows, so the user learns it
 * once.
 */
export function CategoryEditorPencil({ label, className, onClick }: {
  readonly label: string;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"pencil-plate category-editor-pencil" + (className ? " " + className : "")}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <PencilGlyph />
    </button>
  );
}
