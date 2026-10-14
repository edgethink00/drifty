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
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Could not save.");
    expect(onClose).not.toHaveBeenCalled();
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Launch review");
  });

  it("shows the request's error inside the editor and clears it on a successful retry", async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({ saved: false, error: "Project storage unavailable" })
      .mockResolvedValueOnce(true);
    const onClose = vi.fn();
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Project storage unavailable");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Launch review" }));
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("handles a rejected save without losing the draft", async () => {
    render(<ProjectEditorModal project={null} projects={[]} onSave={async () => { throw new Error("Storage unavailable"); }} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.firstChild?.textContent).toBe("Could not save. Your changes are kept. Try again.");
    expect(alert.getAttribute("title")).toBe("Storage unavailable");
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
    expect(within(dialog).getByLabelText("Name").closest("fieldset")).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "Close project editor" })).toHaveProperty("disabled", true);
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

  it("saves from the keyboard: Enter in the name, ⌘↵ from the description, never a newline", async () => {
    const onSave = vi.fn(async () => true);
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    const name = within(dialog).getByLabelText("Name");
    const description = within(dialog).getByLabelText("Description");

    fireEvent.keyDown(name, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Launch review" } });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(description, { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Launch review" }));
  });

  it("submits once with Enter from the name and shows each key on the action it presses", async () => {
    const onSave = vi.fn(async () => true);
    render(<ProjectEditorModal project={null} projects={[]} onSave={onSave} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    const create = within(dialog).getByRole("button", { name: "Create project" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });

    expect(create.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
    expect(create.textContent).toContain("⌘↵");
    expect(cancel.getAttribute("aria-keyshortcuts")).toBe("Escape");

    const name = within(dialog).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Launch review" } });
    fireEvent.keyDown(name, { key: "Enter", isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
