export type AuxiliarySurface = "watcher" | "companion" | "drift-alarm";

export function resolveAuxiliarySurface(search: string): AuxiliarySurface | null {
  const requestedSurface = new URLSearchParams(search).get("driftySurface");
  if (
    requestedSurface === "watcher"
    || requestedSurface === "companion"
    || requestedSurface === "drift-alarm"
  ) {
    return requestedSurface;
  }
  return null;
}
