import { PET_MODE_RUN_FRAME_COUNT } from "./petModeData";

export function getPetModeRunFrameSource(frame: number): string {
  const integerFrame = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const normalizedFrame = (
    (integerFrame % PET_MODE_RUN_FRAME_COUNT) + PET_MODE_RUN_FRAME_COUNT
  ) % PET_MODE_RUN_FRAME_COUNT;
  return `/pet-mode/run/f${String(normalizedFrame + 1).padStart(3, "0")}.png`;
}

export const PET_MODE_RUN_FRAME_SOURCES = Array.from(
  { length: PET_MODE_RUN_FRAME_COUNT },
  (_, frame) => getPetModeRunFrameSource(frame),
);
