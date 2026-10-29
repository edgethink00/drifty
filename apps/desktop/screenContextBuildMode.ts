/** One shared environment choice for the renderer, native build and package. */
export function resolveScreenContextBuildMode(raw: string | undefined): "included" | "excluded" {
  if (raw === undefined || raw === "included") return "included";
  if (raw === "excluded") return "excluded";
  throw new Error("DRIFTY_SCREEN_CONTEXT_MODE must be included or excluded");
}
