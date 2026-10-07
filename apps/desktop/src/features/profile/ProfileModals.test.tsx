// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditProfileModal, type ProfileDraft } from "./ProfileModals";
import { ModalPresence } from "../../components/ModalPresence";

const PROFILE_DRAFT: ProfileDraft = {
  displayName: "Alex",
  bio: "Building quiet tools.",
  avatarUrl: "",
  websiteUrl: "",
  githubUrl: "",
  linkedinUrl: "",
  isPublic: true,
};

afterEach(cleanup);

describe("EditProfileModal focus lifecycle", () => {
  it("moves focus inside, contains Tab, closes on Escape, and restores opener focus", async () => {
    const onClose = vi.fn();
    render(<EditProfileModalHarness onClose={onClose} />);

    const opener = screen.getByRole("button", { name: "Edit public profile" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Edit profile" });
    const closeButton = screen.getByRole("button", { name: "Close profile editor" });
    const displayNameInput = screen.getByLabelText("Display name");
    const saveButton = screen.getByRole("button", { name: "Save profile" });

    await waitFor(() => expect(document.activeElement).toBe(displayNameInput));

    saveButton.focus();
    fireEvent.keyDown(saveButton, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(saveButton);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit profile" })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    expect(dialog.isConnected).toBe(false);
  });

  it("focuses an enabled fallback and ignores Escape while a save is in progress", async () => {
    const onClose = vi.fn();
    render(<EditProfileModalHarness profileSaving onClose={onClose} />);

    const opener = screen.getByRole("button", { name: "Edit public profile" });
    opener.focus();
    fireEvent.click(opener);

    const closeButton = screen.getByRole("button", { name: "Close profile editor" });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EditProfileModal fields", () => {
  it("keeps an emoji name whole in the avatar initial", () => {
    renderEditor({ draft: { displayName: "👩‍💻 Dev" } });

    expect(document.querySelector(".profile-photo-picker__avatar")?.textContent).toBe("👩‍💻");
  });

  it("falls back to the account name for the avatar and the name hint when the draft name is blank", () => {
    renderEditor({ displayName: "member", draft: { displayName: "   " } });

    expect(document.querySelector(".profile-photo-picker__avatar")?.textContent).toBe("M");
    expect(screen.getByLabelText("Display name").getAttribute("placeholder")).toBe("member");
  });

  it("keeps the three links in one labelled group", () => {
    renderEditor();

    const group = screen.getByRole("group", { name: "Public links" });
    expect(within(group).getByLabelText("Website")).toBeTruthy();
    expect(within(group).getByLabelText("GitHub")).toBeTruthy();
    expect(within(group).getByLabelText("LinkedIn")).toBeTruthy();
  });

  it("writes each field's edit to its own draft key", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Writes code." } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "sam.dev" } });
    fireEvent.change(screen.getByLabelText("GitHub"), { target: { value: "github.com/sam" } });
    fireEvent.change(screen.getByLabelText("LinkedIn"), { target: { value: "linkedin.com/in/sam" } });

    expect(onChange.mock.calls.map(([patch]) => patch)).toEqual([
      { displayName: "Sam" },
      { bio: "Writes code." },
      { websiteUrl: "sam.dev" },
      { githubUrl: "github.com/sam" },
      { linkedinUrl: "linkedin.com/in/sam" },
    ]);
  });

  it("offers photo removal only when a photo is set", () => {
    const onRemovePhoto = vi.fn();
    const { rerender } = renderEditor({ onRemovePhoto });
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();

    rerender(editorElement({ avatarUrl: "data:image/png;base64,AAAA", onRemovePhoto }));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(onRemovePhoto).toHaveBeenCalledTimes(1);
  });
});

type EditorOverrides = {
  displayName?: string;
  avatarUrl?: string;
  draft?: Partial<ProfileDraft>;
  onChange?: (patch: Partial<ProfileDraft>) => void;
  onRemovePhoto?: () => void;
};

function editorElement({ displayName = "Alex", avatarUrl = "", draft = {}, onChange = vi.fn(), onRemovePhoto = vi.fn() }: EditorOverrides = {}) {
  return (
    <EditProfileModal
      displayName={displayName}
      avatarUrl={avatarUrl}
      publicId={null}
      profileDraft={{ ...PROFILE_DRAFT, ...draft }}
      profileLoading={false}
      profileSaving={false}
      profileMessage={null}
      profileError={null}
      onClose={vi.fn()}
      onPhotoSelected={vi.fn()}
      onRemovePhoto={onRemovePhoto}
      onChange={onChange}
      onSave={vi.fn()}
    />
  );
}

function renderEditor(overrides: EditorOverrides = {}) {
  return render(editorElement(overrides));
}

function EditProfileModalHarness({
  profileSaving = false,
  onClose,
}: {
  profileSaving?: boolean;
  onClose: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Edit public profile</button>
      <ModalPresence>
        {isOpen ? (
        <EditProfileModal
          displayName="Alex"
          avatarUrl=""
          publicId={null}
          profileDraft={PROFILE_DRAFT}
          profileLoading={false}
          profileSaving={profileSaving}
          profileMessage={null}
          profileError={null}
          onClose={() => {
            onClose();
            setIsOpen(false);
          }}
          onPhotoSelected={vi.fn()}
          onRemovePhoto={vi.fn()}
          onChange={vi.fn()}
          onSave={vi.fn()}
        />
        ) : null}
      </ModalPresence>
    </>
  );
}
