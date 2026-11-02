import type { DisplayLanguage } from "../localization/languageCatalog";
import type { LocalizationController } from "../localization/LocalizationContext";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE } from "./localAiClassificationFailure";
import { NO_UNCLASSIFIED_SEGMENTS_MESSAGE, PROVIDER_PERSISTENCE_DEFERRED_MESSAGE, type AiClassificationSummary } from "./aiClassificationService";

/** What a manual "Run AI classification" command ended with; `busy` means it was dropped because a run was already active. */
export type AiClassificationRunOutcome = AiClassificationSummary | { readonly status: "busy" };

export type AiClassificationRunNoticeModel = {
  readonly key: number;
  readonly role: "status" | "alert";
  readonly title: string;
  readonly detail: string;
};

export function buildAiClassificationRunNotice(
  outcome: AiClassificationRunOutcome,
  key: number,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): AiClassificationRunNoticeModel | null {
  switch (outcome.status) {
    case "busy":
      return { key, role: "status", title: t("classification.runNotice.busyTitle"), detail: t("classification.runNotice.busyDetail") };
    case "disabled":
      return { key, role: "status", title: t("classification.runNotice.setupTitle"), detail: t("classification.runNotice.setupDetail") };
    case "error":
      // Provider and transport errors stay in their original technical wording;
      // the one failure that tells the user what to change is translated.
      return {
        key,
        role: "alert",
        title: t("classification.runNotice.failedTitle"),
        detail: outcome.message === LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE ? t("classification.runNotice.contextBudgetDetail") : outcome.message,
      };
    case "saved": {
      const count = outcome.savedRecords.toLocaleString(localeForDisplayLanguage(language));
      return {
        key,
        role: "status",
        title: t("classification.runNotice.finishedTitle"),
        detail: outcome.savedRecords > 0
          ? t(outcome.savedRecords === 1 ? "classification.runNotice.savedSingle" : "classification.runNotice.savedPlural", { count })
          : t("classification.runNotice.nothingToClassify"),
      };
    }
    case "empty":
      return {
        key,
        role: "status",
        title: t("classification.runNotice.finishedTitle"),
        detail: outcome.message === PROVIDER_PERSISTENCE_DEFERRED_MESSAGE
          ? t("classification.runNotice.waitingForProvider")
          : outcome.message === NO_UNCLASSIFIED_SEGMENTS_MESSAGE || outcome.savedRecords === 0
            ? t("classification.runNotice.nothingToClassify")
            : outcome.message,
      };
    case "idle":
    case "running":
      return null;
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected classification run outcome: ${JSON.stringify(value)}`);
}
