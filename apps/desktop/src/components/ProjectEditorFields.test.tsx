// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectEditorFields, PROJECT_COLOR_SWATCHES } from "./ProjectEditorFields";
import { LocalizationTestProvider } from "../features/localization/LocalizationContext";

describe("ProjectEditorFields", () => {
  it("renders Description field with AI spark indicator while preserving accessible label", () => {
    const { container } = render(
      <LocalizationTestProvider language="en">
        <ProjectEditorFields
          idPrefix="test-project"
          name="Alpha"
          description="Project description context"
          color={PROJECT_COLOR_SWATCHES[0].color}
          onNameChange={vi.fn()}
          onDescriptionChange={vi.fn()}
          onColorChange={vi.fn()}
        />
      </LocalizationTestProvider>,
    );

    // Accessible name remains cleanly "Description"
    const textarea = screen.getByLabelText("Description");
    expect(textarea).toBeTruthy();
    expect(textarea.tagName).toBe("TEXTAREA");
    expect((textarea as HTMLTextAreaElement).value).toBe("Project description context");

    // AI sparkle icon is rendered in the label
    const icon = container.querySelector(".project-editor-field__ai-icon");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.querySelector("svg")).toBeTruthy();
  });
});
