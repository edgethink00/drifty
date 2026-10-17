import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { getViewportSafeHoverPosition, type FixedHoverPosition } from "../../components/hoverCardPosition";
import { useLocalization } from "../localization/LocalizationContext";
import { historyWebUrl } from "./historyPageUrl";

type HistoryPageLinkProps = {
  readonly title: string;
  readonly url: string;
};

/** A recorded web title opens explicitly, independently of the row's selection. */
export function HistoryPageLink({ title, url }: HistoryPageLinkProps) {
  const { t } = useLocalization();
  const id = useId();
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const opening = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState<FixedHoverPosition | null>(null);
  const destination = historyWebUrl(url);
  const showTip = Boolean(destination) && !dismissed && (hovered || focused || failed);

  useLayoutEffect(() => {
    if (!showTip || !anchorRef.current || !tipRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    setPosition(getViewportSafeHoverPosition(anchor.left - 16, anchor.bottom - 8, tip.width, tip.height));
  }, [destination, failed, showTip]);

  useEffect(() => {
    if (!showTip) return;
    const dismiss = () => setDismissed(true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [showTip]);

  async function openPage(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    if (!("__TAURI_INTERNALS__" in window)) return;
    event.preventDefault();
    if (!destination || opening.current) return;
    opening.current = true;
    setDismissed(true);
    setFailed(false);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(destination);
    } catch {
      setFailed(true);
      setDismissed(false);
    } finally {
      opening.current = false;
    }
  }

  if (!destination) return <>{title}</>;

  return (
    <span className="history-page-title">
      <a
        ref={anchorRef}
        className="history-page-link"
        href={destination}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("history.openPageAria", { title })}
        aria-describedby={showTip ? id : undefined}
        onClick={(event) => void openPage(event)}
        onMouseEnter={() => { setHovered(true); setDismissed(false); setPosition(null); }}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => { setFocused(true); setDismissed(false); setPosition(null); }}
        onBlur={() => { setFocused(false); setFailed(false); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && showTip) {
            event.stopPropagation();
            setDismissed(true);
          }
        }}
      >
        <span className="history-page-link__text">{title}</span>
        <ExternalLinkIcon />
      </a>
      {showTip ? createPortal(
        <div
          ref={tipRef}
          id={id}
          role={failed ? "alert" : "tooltip"}
          className="history-page-destination"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : "hidden" }}
        >
          <strong>{failed ? t("history.openPageError") : t("history.openPage")}</strong>
          {!failed ? <span>{destination}</span> : null}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
