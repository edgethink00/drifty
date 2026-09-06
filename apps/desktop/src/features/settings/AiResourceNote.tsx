import { useLocalization } from "../localization/LocalizationContext";
import "./AiResourceNote.css";

/** The same processing tradeoff at setup, model selection, and checkout. */
export function AiResourceNote({ route }: { readonly route: "local" | "cloud" }) {
  const { t } = useLocalization();
  return <p className="ai-resource-note">{t(route === "local" ? "ai.resources.localImpact" : "ai.resources.cloudImpact")}</p>;
}
