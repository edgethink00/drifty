import type { ChangeEvent } from "react";
import type { LeaderboardRow } from "../leaderboard/leaderboardService";
import { EditProfileModal, ProfileModal, type ProfileDraft } from "./ProfileModals";
import type { PublicProfile } from "./profileService";

export type ProfileDialogsProps = {
  avatarUrl: string;
  displayName: string;
  isProfileEditorOpen: boolean;
  profileDraft: ProfileDraft;
  profileError: string | null;
  profileLoading: boolean;
  profileMessage: string | null;
  profileSaving: boolean;
  selectedLeaderboardRow: LeaderboardRow | null;
  selectedProfileError: string | null;
  selectedProfileLoading: boolean;
  selectedPublicProfile: PublicProfile | null;
  onCloseEditor: () => void;
  onCloseSelectedProfile: () => void;
  onDraftChange: (updater: Partial<ProfileDraft>) => void;
  onPhotoSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  onSaveProfile: () => void;
};

export function ProfileDialogs({
  avatarUrl,
  displayName,
  isProfileEditorOpen,
  profileDraft,
  profileError,
  profileLoading,
  profileMessage,
  profileSaving,
  selectedLeaderboardRow,
  selectedProfileError,
  selectedProfileLoading,
  selectedPublicProfile,
  onCloseEditor,
  onCloseSelectedProfile,
  onDraftChange,
  onPhotoSelected,
  onRemovePhoto,
  onSaveProfile,
}: ProfileDialogsProps) {
  return (
    <>
      {selectedLeaderboardRow ? (
        <ProfileModal
          row={selectedLeaderboardRow}
          profile={selectedPublicProfile}
          isLoading={selectedProfileLoading}
          error={selectedProfileError}
          onClose={onCloseSelectedProfile}
        />
      ) : null}

      {isProfileEditorOpen ? (
        <EditProfileModal
          displayName={displayName}
          avatarUrl={avatarUrl}
          profileDraft={profileDraft}
          profileLoading={profileLoading}
          profileSaving={profileSaving}
          profileMessage={profileMessage}
          profileError={profileError}
          onClose={onCloseEditor}
          onPhotoSelected={onPhotoSelected}
          onRemovePhoto={onRemovePhoto}
          onChange={onDraftChange}
          onSave={onSaveProfile}
        />
      ) : null}
    </>
  );
}
