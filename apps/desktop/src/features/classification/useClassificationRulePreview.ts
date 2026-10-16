import { useEffect, useState } from "react";
import type { ClassificationRuleInput, ClassificationRulePreview } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { classificationRulePreviewKey } from "./classificationRulePreview";

/**
 * Asks the tracker how many past records a rule about to be saved would apply
 * to. Null until it answers, and when it cannot: the note then reads as it did
 * before, without numbers, and the rule still saves.
 */
export function useClassificationRulePreview(input: ClassificationRuleInput | null): ClassificationRulePreview | null {
  const key = classificationRulePreviewKey(input);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly preview: ClassificationRulePreview } | null>(null);

  useEffect(() => {
    // A closed form forgets its answer: the next one may follow a save that
    // changed those very records.
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
        // A preview is a courtesy; saving the rule does not depend on it.
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
