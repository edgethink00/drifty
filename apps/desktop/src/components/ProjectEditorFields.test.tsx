// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEditorFields, PROJECT_COLOR_SWATCHES } from "./ProjectEditorFields";
import { LocalizationTestProvider } from "../features/localization/LocalizationContext";

afterEach(cleanup);

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
    const icon = container.querySelector(".ai-field-mark");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.querySelector("svg")).toBeTruthy();
  });

  it("keeps the name input labelled while the color chip leads the same field", () => {
    render(
      <LocalizationTestProvider language="en">
        <ProjectEditorFields
          idPrefix="test-project"
          name="Alpha"
          description=""
          color={PROJECT_COLOR_SWATCHES[0].color}
          onNameChange={vi.fn()}
          onDescriptionChange={vi.fn()}
          onColorChange={vi.fn()}
        />
      </LocalizationTestProvider>,
    );
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Alpha");
    const chip = screen.getByRole("button", { name: "Project color · Indigo" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("opens the palette inside the field, marks colors used by other projects, and closes on pick", () => {
    const onColorChange = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <ProjectEditorFields
          idPrefix="test-project"
          name=""
          description=""
          color={PROJECT_COLOR_SWATCHES[0].color}
          usedColors={new Set([PROJECT_COLOR_SWATCHES[1].color])}
          onNameChange={vi.fn()}
          onDescriptionChange={vi.fn()}
          onColorChange={onColorChange}
        />
      </LocalizationTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 색상 · 인디고" }));
    const group = screen.getByRole("radiogroup", { name: "프로젝트 색상" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("radio", { name: "인디고" }).getAttribute("aria-checked")).toBe("true");

    const usedPink = screen.getByRole("radio", { name: "분홍 · 다른 프로젝트에서 사용 중" });
    expect(usedPink.className).toContain("is-used");
    fireEvent.click(usedPink);
    expect(onColorChange).toHaveBeenCalledWith(PROJECT_COLOR_SWATCHES[1].color);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("resolves a legacy vivid color to its palette slot so the chip matches a swatch", () => {
    render(
      <LocalizationTestProvider language="en">
        <ProjectEditorFields
          idPrefix="test-project"
          name=""
          description=""
          color="#6366f1"
          onNameChange={vi.fn()}
          onDescriptionChange={vi.fn()}
          onColorChange={vi.fn()}
        />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("button", { name: "Project color · Indigo" })).toBeTruthy();
  });
});
