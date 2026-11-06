// The local team-project mirror (team projects copied into the tracker so the
// on-device project pass can classify against them) changes from the Teams
// feature, while project analysis reads it from the classification feature.
// This event tells readers to look again after a write.
const TEAM_PROJECT_MIRROR_CHANGED_EVENT = "drifty:team-project-mirror-changed";

export function notifyTeamProjectMirrorChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TEAM_PROJECT_MIRROR_CHANGED_EVENT));
}

export function subscribeTeamProjectMirrorChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(TEAM_PROJECT_MIRROR_CHANGED_EVENT, listener);
  return () => window.removeEventListener(TEAM_PROJECT_MIRROR_CHANGED_EVENT, listener);
}

// Automatic team sharing runs app-wide; an open Teams page reads its totals again
// once this person's own time for that team has gone up.
const TEAM_TIME_SHARED_EVENT = "drifty:team-time-shared";

export function notifyTeamTimeShared(organizationId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(TEAM_TIME_SHARED_EVENT, { detail: organizationId }));
}

export function subscribeTeamTimeShared(listener: (organizationId: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener(TEAM_TIME_SHARED_EVENT, handler);
  return () => window.removeEventListener(TEAM_TIME_SHARED_EVENT, handler);
}
