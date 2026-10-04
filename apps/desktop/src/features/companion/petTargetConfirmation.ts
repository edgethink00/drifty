export type PetTargetConfirmation = "confirmed" | "current-window-changed"
  | "current-snapshot-unavailable" | "system-transient-active";

export const PET_TARGET_RECHECK_DELAY_MS = 750;

type PetTargetConfirmationInput = {
  readonly confirm: () => Promise<PetTargetConfirmation>;
  readonly isAuthorized: () => boolean;
  readonly retryUnavailable: boolean;
};

/** Recheck capture once within the same authorized attempt, before any fallback is delivered. */
export async function confirmPetTargetWithRecovery(
  input: PetTargetConfirmationInput,
): Promise<PetTargetConfirmation | "cancelled"> {
  if (!input.isAuthorized()) return "cancelled";
  const first = await input.confirm();
  if (!input.isAuthorized()) return "cancelled";
  if (first !== "current-snapshot-unavailable" || !input.retryUnavailable) return first;

  // The single capture worker may still be finishing a prior read. Its late
  // result is discarded; this retry must obtain a fresh, verified snapshot.
  await new Promise<void>(resolve => setTimeout(resolve, PET_TARGET_RECHECK_DELAY_MS));
  if (!input.isAuthorized()) return "cancelled";
  const second = await input.confirm();
  return input.isAuthorized() ? second : "cancelled";
}
