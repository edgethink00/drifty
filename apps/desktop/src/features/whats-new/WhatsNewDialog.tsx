import { useId } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import type { WhatsNewEntry } from "./whatsNewChangelog";
import type { WhatsNewChangelogStatus } from "./useWhatsNewChangelog";
import "./WhatsNewDialog.css";

export type WhatsNewDialogProps = {
  /** Chapters for this host and build, newest first; null while loading. */
  readonly entries: readonly WhatsNewEntry[] | null;
  readonly status: WhatsNewChangelogStatus;
  readonly onRetry: () => void;
  readonly onClose: () => void;
};

function formatReleaseDate(date: string, locale: string): string {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" })
    .format(new Date(year, month - 1, day));
}

/** The drifty.so changelog as one scrolling list, newest first. Closing is the only action. */
export function WhatsNewDialog({ entries, status, onRetry, onClose }: WhatsNewDialogProps) {
  const { effectiveLanguage, t } = useLocalization();
  const titleId = useId();
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  const locale = effectiveLanguage === "ko" ? "ko-KR" : "en-US";

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell whats-new"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!entries && status === "loading"}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("whatsNew.close")} onClick={onClose} />
        <div className="auth-modal__header whats-new__header">
          <h2 id={titleId}>{t("whatsNew.title")}</h2>
        </div>
        <div className="whats-new__body">
          {entries ? (
            entries.length > 0 ? entries.map((entry) => (
              <article key={entry.id} className="whats-new__release" data-version={entry.toVersion}>
                <header className="whats-new__release-head">
                  <h3 className="whats-new__version">{entry.label}</h3>
                  <time dateTime={entry.date}>{formatReleaseDate(entry.date, locale)}</time>
                </header>
                <p className="whats-new__summary">{entry.summary}</p>
                {entry.items.length > 0 ? (
                  <ul className="whats-new__items">
                    {entry.items.map((item, index) => <li key={index} className="whats-new__item">{item}</li>)}
                  </ul>
                ) : null}
              </article>
            )) : <p className="whats-new__status">{t("whatsNew.empty")}</p>
          ) : status === "error" ? (
            <div className="whats-new__status" role="alert">
              <p>{t("whatsNew.error")}</p>
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onRetry}>{t("whatsNew.retry")}</button>
            </div>
          ) : (
            <p className="whats-new__status" role="status">{t("whatsNew.loading")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
