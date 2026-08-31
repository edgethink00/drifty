// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectEditorModal } from "./ProjectEditorModal";

describe("ProjectEditorModal", () => {
  it("keeps the editor open with the input intact when saving fails", async () => {
    const onSave = vi.fn(async () => false);
    const onClose = vi.fn();
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Launch review");
  });

  it("closes only after persistence succeeds", async () => {
    const onSave = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Launch review", status: "active" }));
  });

  it("does not fire a second save while the first one is still in flight", async () => {
    let resolveSave!: (value: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    const savingButton = await screen.findByRole("button", { name: "Saving…" });
    expect(savingButton).toHaveProperty("disabled", true);
    fireEvent.click(savingButton);
    expect(onSave).toHaveBeenCalledTimes(1);

    resolveSave(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull());
  });

  it("ignores overlay and close-button dismissal while a save is in flight", async () => {
    let resolveSave!: (value: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    const onClose = vi.fn();
    const { container } = render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await screen.findByRole("button", { name: "Saving…" });

    const overlay = container.querySelector(".auth-modal__overlay");
    if (!overlay) throw new Error("The modal should render an overlay.");
    fireEvent.click(overlay);
    fireEvent.click(screen.getByRole("button", { name: "Close project editor" }));
    expect(onClose).not.toHaveBeenCalled();

    resolveSave(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
