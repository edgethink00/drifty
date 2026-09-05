export const PET_INTERCEPTION_GRACE_MS = 70 * 1_000;

export type PetInterceptionGrace = {
  readonly episodeKey: string;
  readonly untilMs: number;
};

export function buildPetInterceptionGrace(
  episodeKey: string,
  nowMs = Date.now(),
): PetInterceptionGrace {
  return {
    episodeKey,
    untilMs: nowMs + PET_INTERCEPTION_GRACE_MS,
  };
}

export function isPetInterceptionGraceActive(
  grace: PetInterceptionGrace | null,
  episodeKey: string,
  nowMs = Date.now(),
): boolean {
  return grace?.episodeKey === episodeKey && nowMs < grace.untilMs;
}
