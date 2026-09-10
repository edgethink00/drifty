/**
 * `profiles.is_public` is independent of leaderboard participation, and
 * `get_public_profile` LEFT JOINs the ranking row, so a profile keeps serving name, bio,
 * and links after the user leaves the board. Reporting that as a steady state rather than
 * a one-shot message after opting out is deliberate: the surprising combination outlives
 * the moment it was created, and a user who left before this shipped never saw that moment.
 *
 * Participants are excluded because joining the board is itself an explicit publication
 * choice; the non-obvious case is being off the board while the page stays live.
 */
export function isPublicProfileLiveOffBoard(input: {
  readonly isParticipationResolved: boolean;
  readonly isOptedIn: boolean;
  readonly isProfileReady: boolean;
  readonly isPublic: boolean | null | undefined;
}): boolean {
  // Never assert a publication state we have not actually resolved yet: a flash of
  // "your page is public" during session restore would be its own falsehood.
  if (!input.isParticipationResolved || !input.isProfileReady) return false;
  if (input.isOptedIn) return false;
  return input.isPublic === true;
}
