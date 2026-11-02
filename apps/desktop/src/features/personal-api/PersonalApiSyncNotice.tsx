import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";

/**
 * Whether this computer adds its records to the cloud copy the API reads.
 * "off" says so when the account's other computers are unknown; "off-others"
 * when another computer syncs; "none" when no computer on the account syncs,
 * so a key would have nothing to read. "limit" and "none-limit" are the same
 * for a computer past the three-computer limit. "turning-on" and "failed"
 * follow a turn-on started here; "on-now" closes that loop in the dialog that
 * shows a new key.
 */
export type PersonalApiSyncNoticeState =
  | "off"
  | "off-others"
  | "none"
  | "limit"
  | "none-limit"
  | "turning-on"
  | "failed"
  | "on-now";

/** Beside the keys, or in the dialog that shows a new key and the command to try it. */
export type PersonalApiSyncNoticePlace = "block" | "reveal";

function messageKey(state: PersonalApiSyncNoticeState, place: PersonalApiSyncNoticePlace): TranslationKey {
  switch (state) {
    case "off":
    case "off-others":
    case "none":
      if (place === "reveal") return "settings.developer.api.reveal.syncOff";
      return state === "off"
        ? "settings.developer.api.syncOff"
        : state === "off-others" ? "settings.developer.api.syncOffOthers" : "settings.developer.api.syncNone";
    case "limit":
    case "none-limit":
      if (place === "reveal") return "settings.developer.api.reveal.syncLimit";
      return state === "limit" ? "settings.developer.api.syncLimit" : "settings.developer.api.syncNoneLimit";
    case "turning-on":
      return "settings.developer.api.syncTurningOn";
    case "failed":
      return "settings.developer.api.syncTurnOnFailed";
    case "on-now":
      return "settings.developer.api.reveal.syncOnNow";
  }
}

/**
 * One line that says what sync means for the API and offers the one step that
 * applies. Turning sync on goes through Sync's own consent dialog; a computer
 * over the device limit is resolved in Sync's device list, so it links there.
 * The caller passes only the callbacks that apply: when its main button
 * already turns sync on, the line carries no second way to do it.
 */
export function PersonalApiSyncNotice({
  id,
  state,
  place,
  onTurnOnSync,
  onOpenSyncSettings,
}: {
  readonly id?: string;
  readonly state: PersonalApiSyncNoticeState;
  readonly place: PersonalApiSyncNoticePlace;
  /** Opens the consent dialog; absent when sync cannot be turned on from here. */
  readonly onTurnOnSync?: () => void;
  readonly onOpenSyncSettings?: () => void;
}): JSX.Element {
  const { t } = useLocalization();
  const canTurnOn = state === "off" || state === "off-others" || state === "failed";
  // Leaving for Sync settings would close a shown key, so only the block links there.
  const linksToSync = place === "block" && state !== "turning-on" && state !== "on-now";
  const action = canTurnOn && onTurnOnSync
    ? { label: t("settings.developer.api.turnOnSync"), onClick: onTurnOnSync }
    : linksToSync && onOpenSyncSettings
      ? { label: t("settings.developer.api.openSync"), onClick: onOpenSyncSettings }
      : null;
  const tone = state === "on-now" ? "ok" : state === "turning-on" ? "busy" : "attention";
  return (
    <div
      id={id}
      className={"personal-api__sync-notice personal-api__sync-notice--" + tone}
      role={tone === "attention" ? undefined : "status"}
    >
      <span className="personal-api__sync-dot" aria-hidden="true" />
      {/* The action follows the sentence as text does, so a long line wraps under itself, not under the dot. */}
      <span className="personal-api__sync-text">
        {t(messageKey(state, place))}
        {action ? (
          <>
            {" "}
            <button type="button" className="personal-api__inline-action" onClick={action.onClick}>{action.label}</button>
          </>
        ) : null}
      </span>
    </div>
  );
}
