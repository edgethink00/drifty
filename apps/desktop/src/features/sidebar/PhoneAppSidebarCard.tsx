import { useId } from "react";
import { localeForDisplayLanguage } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languageCatalog";
import { useLocalization } from "../localization/LocalizationContext";
import type { SidebarCtaPhoneAppState } from "./SidebarCtaSlot";
/*
 * Encodes phoneAppStoreUrl("drifty_desktop_sidebar"). Regenerate with
 *   npx qrcode@1.5.4 -t svg -e M -q 2 -d "#111111" -l "#ffffff" -o iphone-app-store-qr-sidebar.svg "<url>"
 * when that link changes, then scan the result before committing it. The code
 * is 45 modules with its quiet zone, so 90px keeps every module on whole pixels.
 */
import sidebarQrUrl from "../../assets/iphone-app-store-qr-sidebar.svg";
import "./PhoneAppSidebarCard.css";

type PhoneAppSidebarCardProps = {
  readonly state: SidebarCtaPhoneAppState;
  /** Opens the larger code with the App Store link, for a phone held farther away. */
  readonly onEnlarge: () => void;
  readonly onDismiss?: () => void;
};

/**
 * Drifty for iPhone in the sidebar slot: the QR code is the card. A computer
 * cannot pre-order or install an iPhone app, so the card shows the code the
 * iPhone camera needs right away, with the release date and price beside it
 * in plain text.
 */
export function PhoneAppSidebarCard({ state, onEnlarge, onDismiss }: PhoneAppSidebarCardProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  const released = state.phase === "released";
  const [firstDateLine, secondDateLine] = formatMonthDayLines(state.releaseDate, effectiveLanguage);
  const dismissLabel = t("sidebar.cta.phoneApp.dismiss");

  return (
    <div className="sidebar-cta-slot-wrap" data-kind="phone-app" data-dismissible={onDismiss ? "true" : undefined}>
      <div
        className="sidebar-cta-slot sidebar-cta-slot--phone-app"
        data-kind="phone-app"
        data-tone={state.tone}
        data-phase={state.phase}
        role="group"
        aria-labelledby={titleId}
      >
        <strong id={titleId} className="sidebar-cta-slot__title phone-app-card__title">
          {t(released ? "sidebar.cta.phoneApp.releasedTitle" : "sidebar.cta.phoneApp.preorderTitle")}
        </strong>
        <div className="phone-app-card__body">
          <button
            type="button"
            className="phone-app-card__qr"
            aria-label={t("sidebar.cta.phoneApp.enlarge")}
            title={t("sidebar.cta.phoneApp.enlarge")}
            onClick={onEnlarge}
          >
            <img src={sidebarQrUrl} alt="" width={90} height={90} draggable={false} />
          </button>
          <div className="phone-app-card__meta">
            {released ? null : (
              <>
                <span className="phone-app-card__label">{t("sidebar.cta.phoneApp.releaseLabel")}</span>
                <span className="phone-app-card__date">
                  <span>{firstDateLine}</span>
                  <span>{secondDateLine}</span>
                </span>
              </>
            )}
            <span className="phone-app-card__price">{t("sidebar.cta.phoneApp.free")}</span>
          </div>
        </div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="sidebar-cta-slot__dismiss"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m3 3 6 6M9 3 3 9" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The release date as two short lines for the narrow column beside the code,
 * in the display language's order: "11월" over "16일", "Nov" over "16",
 * "16." over "Nov.". The first line keeps its own mark ("월", "月", ".") but
 * not a joining word such as Portuguese "de". A calendar date, so no time
 * zone may move it.
 */
export function formatMonthDayLines(isoDate: string, language: DisplayLanguage): readonly [string, string] {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return [isoDate, ""];
  const parts = new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short", day: "numeric", timeZone: "UTC" })
    .formatToParts(new Date(Date.UTC(year, month - 1, day)));
  const first = parts.findIndex((part) => part.type !== "literal");
  const second = parts.findIndex((part, index) => index > first && part.type !== "literal");
  if (first < 0 || second < 0) return [parts.map((part) => part.value).join("").trim(), ""];
  const joiner = parts.slice(first + 1, second).map((part) => part.value).join("").trim();
  const keepsJoiner = joiner.length > 0 && !/[\p{Script=Latin}\s]/u.test(joiner);
  return [
    parts[first].value + (keepsJoiner ? joiner : ""),
    parts.slice(second).map((part) => part.value).join("").trim(),
  ];
}
