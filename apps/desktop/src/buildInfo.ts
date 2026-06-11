declare const __DRIFTY_BUILD_COMMIT__: string;

export type BuildInfo = {
  readonly commit: string;
  readonly shortCommit: string;
};

const UNKNOWN_BUILD_COMMIT = "unknown";
const SHORT_COMMIT_LENGTH = 12;

export function normalizeBuildCommit(rawCommit: string): string {
  const trimmed = rawCommit.trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_BUILD_COMMIT;
}

export function buildShortCommit(commit: string): string {
  if (commit === UNKNOWN_BUILD_COMMIT) return UNKNOWN_BUILD_COMMIT;
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

export function createBuildInfo(rawCommit: string): BuildInfo {
  const commit = normalizeBuildCommit(rawCommit);
  return {
    commit,
    shortCommit: buildShortCommit(commit),
  };
}

const RAW_BUILD_COMMIT = typeof __DRIFTY_BUILD_COMMIT__ === "string" ? __DRIFTY_BUILD_COMMIT__ : UNKNOWN_BUILD_COMMIT;

export const BUILD_INFO = createBuildInfo(RAW_BUILD_COMMIT);
