import { useEffect, useState } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { readChatCloudStatus, type ChatCloudStatus } from "./chatCloudClient";
import { CHAT_COPY, chatLanguage } from "./chatCopy";
import "./chat.css";

type CloudInvoke = Parameters<typeof readChatCloudStatus>[0];

/**
 * Settings › Account row for Drifty Cloud chat credits, like Aside's Plan and
 * Usage and Raycast's AI credits: what is left this period, out of how many,
 * and when it renews. Shown wherever Chat is available.
 */
export function ChatCreditsRow({ invoke }: { readonly invoke?: CloudInvoke }) {
  const { effectiveLanguage } = useLocalization();
  const copy = CHAT_COPY[chatLanguage(effectiveLanguage)];
  const [status, setStatus] = useState<ChatCloudStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readChatCloudStatus(invoke).then((next) => { if (!cancelled) setStatus(next); });
    return () => { cancelled = true; };
  }, [invoke]);

  const ready = status?.kind === "ready" && status.available ? status : null;
  const remaining = ready?.credits.remaining ?? 0;
  const granted = ready?.credits.granted ?? 0;
  const share = granted > 0 ? Math.max(0, Math.min(1, remaining / granted)) : 0;
  const description = !status
    ? copy.cloudChecking
    : status.kind === "sign_in_required" || status.kind === "full_account_required"
      ? copy.cloudSignIn
      : status.kind !== "ready"
        ? copy.cloudUnavailable
        : !status.available
          ? copy.cloudPlanRequired
          : copy.creditsAccountDetail;

  return (
    <div data-setting-id="settings.account.chatCredits" className="settings-row chat-credits-row">
      <div className="chat-credits-row__text">
        <div className="lbl">{copy.creditsAccountTitle}</div>
        <div className="desc">{description}</div>
      </div>
      {ready ? (
        <div className="ctrl chat-credits-row__meter">
          <span className="chat-credits-row__count">{copy.creditsAccountCount(remaining, granted)}</span>
          <span className="chat-credits-row__bar" role="meter" aria-label={copy.creditsAccountTitle} aria-valuemin={0} aria-valuemax={granted} aria-valuenow={remaining}>
            <span style={{ width: (share * 100).toFixed(1) + "%" }} />
          </span>
          {ready.credits.renewsAt ? <span className="chat-credits-row__renews">{copy.creditsAccountRenews(ready.credits.renewsAt)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

