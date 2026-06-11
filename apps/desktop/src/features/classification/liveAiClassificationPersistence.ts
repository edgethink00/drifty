import type { ActivityClassificationRecord } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";

export async function saveLiveClassificationIfRequested(
  classification: ActivityClassificationRecord,
  shouldPersist: boolean | undefined,
): Promise<void> {
  if (!shouldPersist) return;

  try {
    await trackerClient.saveClassifications([classification]);
  } catch {
    return;
  }
}
