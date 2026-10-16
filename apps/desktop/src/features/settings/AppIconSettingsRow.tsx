import { useId, useState } from "react";
import { describeActionError } from "../../lib/actionErrors";
import { APP_ICON_VARIANT_IDS } from "../../lib/api/appIconClient";
import { useLocalization } from "../localization/LocalizationContext";
import { APP_ICON_LABEL_KEYS, APP_ICON_PREVIEWS } from "../pro-looks/proLookCatalog";
import { ProLookLockBadge, ProLookPopover, ProLookRowNote } from "../pro-looks/ProLookViews";
import { useProLooks } from "../pro-looks/useProLooksController";

/**
 * macOS only. The choice lives on this Mac (it never syncs) and changes the
 * Dock and app switcher while Drifty runs; Finder keeps the bundle icon. The
 * Classic and Midnight are free; every other icon is a Pro look (features/pro-looks):
 * a locked one is tried on in the Dock while its bubble is open.
 */
export function AppIconSettingsRow() {
  const { t } = useLocalization();
  const looks = useProLooks();
  const descriptionId = useId();
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  if (!looks) return null;
  // Null until the saved choice arrives, so no option flashes as selected.
  const selected = looks.appIcon;
  const failure = looks.appIconFailure
    ? describeActionError(looks.appIconFailure.reason, t("settings.appearance.appIconFailed"))
    : null;

  return (
    <div ref={setRow} data-setting-id="settings.appearance.appIcon" className="settings-row settings-row--app-icon">
      <div>
        <div className="lbl">{t("settings.appearance.appIcon")}</div>
        <div className="desc" id={descriptionId}>{t("settings.appearance.appIconDescription")}</div>
        {failure ? <p className="desc" role="alert" title={failure.detail ?? undefined}>{failure.message}</p> : null}
      </div>
      <div className="ctrl">
        <div className="app-icon-picker" role="radiogroup" aria-label={t("settings.appearance.appIcon")} aria-describedby={descriptionId}>
          {APP_ICON_VARIANT_IDS.map((variant) => {
            const look = { kind: "icon", id: variant } as const;
            const name = t(APP_ICON_LABEL_KEYS[variant]);
            const locked = looks.isLocked(look);
            const label = locked ? t("settings.proLooks.lockedLabel", { name }) : name;
            const isSelected = variant === selected;
            const tryingOn = looks.preview?.kind === "icon" && looks.preview.id === variant;
            return (
              <button
                key={variant}
                type="button"
                className={"app-icon-swatch" + (isSelected ? " is-selected" : "") + (tryingOn ? " is-trying-on" : "")}
                role="radio"
                aria-checked={isSelected}
                aria-label={label}
                aria-haspopup={locked ? "dialog" : undefined}
                title={label}
                data-pro-look={"icon:" + variant}
                onClick={() => looks.pick(look)}
              >
                <img className="app-icon-swatch__image" src={APP_ICON_PREVIEWS[variant]} alt="" draggable={false} />
                {locked ? <ProLookLockBadge /> : null}
              </button>
            );
          })}
        </div>
        <ProLookRowNote looks={looks} kind="icon" />
      </div>
      <ProLookPopover looks={looks} kind="icon" container={row} />
    </div>
  );
}

