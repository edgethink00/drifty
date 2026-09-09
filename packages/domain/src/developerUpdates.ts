/** Public release selection DTOs; no activity or credentials leave the app. */
export type DeveloperRelease = {
  readonly tag: string;
  readonly version: string;
  readonly prerelease: boolean;
  readonly publishedAt: string | null;
};
export type DeveloperReleaseList = {
  readonly currentVersion: string;
  readonly releases: readonly DeveloperRelease[];
  readonly hasMore: boolean;
  readonly installUnavailableReason?: string | null;
  readonly backupDirectory?: string;
};
export type DeveloperReleaseInstallResult = {
  readonly backupPath: string | null;
  readonly version: string;
};
