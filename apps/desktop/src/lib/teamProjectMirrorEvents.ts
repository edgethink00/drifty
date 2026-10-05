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
