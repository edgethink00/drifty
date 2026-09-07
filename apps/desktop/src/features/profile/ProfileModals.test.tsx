// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
