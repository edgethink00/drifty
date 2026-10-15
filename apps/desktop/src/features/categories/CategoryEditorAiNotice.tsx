import { useState } from "react";
import { aiProviderBrandMark } from "../settings/AiProviderBrandMark";
import { useLocalization } from "../localization/LocalizationContext";
import { ChevronRightIcon, LockIcon } from "./definitionIcons";

/**
 * The projects tab while Intelligence (the project model) is missing. Only
 * people without Drifty Cloud or their own model meet it (on-device Free or
 * unset): the tab carries a lock, an empty tab lists the ways in, and a tab
 * that still lists projects (a trial ended, say) keeps them closed under a band.
 */

/** What Drifty Cloud takes for this person: signing in, starting the free trial, or a paid plan. */
export type CloudOffer = "sign-in" | "trial" | "plan";

/** A model the lock screen can connect, as Settings › Intelligence names them. */
export type IntelligenceProviderChoice = "cloud" | "openrouter" | "self_hosted" | "openai" | "anthropic";

/** The band over a locked tab that still lists projects. */
export function CategoryEditorLockBand({ disabled = false, onOpen }: {
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useLocalization();
  return (
    <p className="category-editor__ai-note is-lock">
      <LockIcon />
      <span className="category-editor__ai-note-text">{t("categoryEditor.intelligence.lock")}</span>
      <button type="button" className="category-editor__ai-link" disabled={disabled} onClick={onOpen}>{t("categoryEditor.intelligence.open")}<ChevronRightIcon /></button>
    </p>
  );
}

const CLOUD_DETAIL = { "sign-in": "categoryEditor.intelligence.cloudSignIn", trial: "categoryEditor.intelligence.cloudTrial", plan: "categoryEditor.intelligence.cloudPlan" } as const;
const CLOUD_GO = { "sign-in": "categoryEditor.intelligence.cloudGoSignIn", trial: "categoryEditor.intelligence.cloudGoTrial", plan: "categoryEditor.intelligence.cloudGoPlan" } as const;

type ProviderRow = {
  readonly id: IntelligenceProviderChoice;
  readonly name: string;
  readonly detail: string;
  readonly brand: Parameters<typeof aiProviderBrandMark>[0];
};

/**
 * The empty projects tab while Intelligence locks it: one title and one row
 * per way in, each its own button (Dayflow onboarding's per-provider Select).
 * Drifty Cloud says up front what it takes and ends in that step's button so a
 * trial never starts by accident; a ready OpenRouter key connects here; other
 * models open their card in Settings › Intelligence.
 */
export function CategoryEditorLockScreen({ disabled = false, cloudOffer = "plan", openRouterReady = false, hideTitle = false, onPick }: {
  readonly disabled?: boolean;
  /** The Projects page puts its own title over the rows. */
  readonly hideTitle?: boolean;
  readonly cloudOffer?: CloudOffer;
  /** An OpenRouter key is already in the Keychain (classification uses it), so it connects in place. */
  readonly openRouterReady?: boolean;
  readonly onPick: (provider: IntelligenceProviderChoice) => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const [busy, setBusy] = useState<IntelligenceProviderChoice | null>(null);
  const off = disabled || busy !== null;
  const run = (provider: IntelligenceProviderChoice) => {
    const pending = onPick(provider);
    if (!pending) return;
    setBusy(provider);
    void pending.finally(() => setBusy(null));
  };
  const rows: readonly ProviderRow[] = [
    { id: "cloud", name: "Drifty Cloud", detail: t(CLOUD_DETAIL[cloudOffer]), brand: "drifty" },
    { id: "openrouter", name: "OpenRouter", detail: t(openRouterReady ? "categoryEditor.intelligence.openRouterReady" : "categoryEditor.intelligence.ownKey"), brand: "openrouter" },
    { id: "self_hosted", name: t("settings.ai.customEndpoint"), detail: t("categoryEditor.intelligence.customDetail"), brand: "custom" },
    { id: "openai", name: "OpenAI", detail: t("categoryEditor.intelligence.ownKey"), brand: "openai" },
    { id: "anthropic", name: "Anthropic", detail: t("categoryEditor.intelligence.ownKey"), brand: "anthropic" },
  ];
  return (
    <div className="category-editor__lock">
      {hideTitle ? null : <p className="category-editor__lock-title">{t("categoryEditor.intelligence.providersTitle")}</p>}
      <div className="category-editor__providers">
        {rows.map((row) => (
          <button key={row.id} type="button" className="category-editor__provider" disabled={off} aria-busy={busy === row.id} onClick={() => run(row.id)}>
            {aiProviderBrandMark(row.brand, { pick: true })}
            <span className="category-editor__provider-text">
              <span className="category-editor__provider-name">{row.name}</span>
              <span className="category-editor__provider-detail">{row.detail}</span>
            </span>
            {row.id === "cloud"
              ? <span className="category-editor__provider-pill">{t(CLOUD_GO[cloudOffer])}</span>
              : row.id === "openrouter" && openRouterReady
                ? <span className="category-editor__provider-ready">{t("categoryEditor.intelligence.actionNow")}</span>
                : <span className="category-editor__provider-chevron" aria-hidden="true"><ChevronRightIcon /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}
