import { useEffect, useState } from "react";
import type { ClassificationRulePreview } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import type { ClassificationCorrectionDraft } from "./classificationCorrection";
import { classificationRulePreviewInput, classificationRulePreviewKey } from "./classificationRulePreview";

/**
 * Asks the tracker how many past records the open correction's rule would
 * apply to. Null until it answers, and when it cannot: the scope note then
 * reads as it did before, without numbers, and the correction still saves.
 */
export function useClassificationRulePreview(draft: ClassificationCorrectionDraft | null): ClassificationRulePreview | null {
  const input = draft ? classificationRulePreviewInput(draft) : null;
  const key = classificationRulePreviewKey(input);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly preview: ClassificationRulePreview } | null>(null);

  useEffect(() => {
    // A closed correction forgets its answer: the next one may follow a save
    // that changed those very records.
    if (!key || !input) {
      setAnswer(null);
      return;
    }
    let current = true;
    // Started from a resolved promise so that a failure of any kind, even before
    // the request leaves, only means no numbers.
    Promise.resolve().then(() => trackerClient.previewClassificationRule(input)).then(
      (preview) => {
        if (current && preview) setAnswer({ key, preview });
      },
      () => {
        // A preview is a courtesy; the correction itself does not depend on it.
      },
    );
    return () => {
      current = false;
    };
    // The key holds everything the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return answer && answer.key === key ? answer.preview : null;
}
