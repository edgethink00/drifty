const TRACKER_DATABASE_UNAVAILABLE = "tracker_database_unavailable";

export function isTrackerDatabaseUnavailable(error: unknown): boolean {
  return error instanceof TrackerInvokeError && error.code === TRACKER_DATABASE_UNAVAILABLE;
}

export class TrackerInvokeError extends Error {
  readonly code: typeof TRACKER_DATABASE_UNAVAILABLE | null;

  constructor(command: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`${command} failed: ${message}`);
    this.name = "TrackerInvokeError";
    this.code = cause === TRACKER_DATABASE_UNAVAILABLE ? TRACKER_DATABASE_UNAVAILABLE : null;
  }
}
