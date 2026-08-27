export type AuxiliarySurface = "watcher" | "companion";

export function resolveAuxiliarySurface(search: string): AuxiliarySurface | null {
  const requestedSurface = new URLSearchParams(search).get("driftySurface");
  if (
    requestedSurface === "watcher"
    || requestedSurface === "companion"
  ) {
    return requestedSurface;
  }
  return null;
}
