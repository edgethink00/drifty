import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { ScreenEvidenceDetail } from "@drifty/domain";
import { ModalPresence } from "../../components/ModalPresence";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenDeletion, decodeScreenDetail, decodeScreenStatus } from "./screenContextWire";
import { loadScreenEvidenceRows, type ScreenEvidenceRow, type ScreenEvidenceSource } from "./useScreenEvidenceRows";
import "../../styles/modal-chrome.css";
import "./activity-screen-evidence.css";

type Bound<T> = { readonly generation: number; readonly value: T };
const MAX_TICKS = 60;

function Chevron({ direction }: { readonly direction: "left" | "right" }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={direction === "left" ? "M9.8 3.8 5.6 8l4.2 4.2" : "M6.2 3.8 10.4 8l-4.2 4.2"} />
  </svg>;
}

/** One place to look back at saved screens: an activity's screens or the recent ones. */
export function ScreenReplayViewer({ client, source, title, subtitle, initialRecordId = null, onClose, onInvalidated }: {
  readonly client: ScreenContextClient;
  readonly source: ScreenEvidenceSource;
  readonly title: string;
  readonly subtitle?: string;
  readonly initialRecordId?: string | null;
  readonly onClose: () => void;
  readonly onInvalidated: () => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const locale = localeForDisplayLanguage(effectiveLanguage);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const initialGeneration = useRef(snapshot.generation);
  const [rows, setRows] = useState<Bound<ScreenEvidenceRow[]> | null>(null);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<Bound<ScreenEvidenceDetail | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [showText, setShowText] = useState(false);
  const mutationGeneration = useRef<number | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
  const listRequest = useRef(0);
  const readRequest = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateRef = useRef(onInvalidated); invalidateRef.current = onInvalidated;
  const sourceRef = useRef(source); sourceRef.current = source;

  const cancelDelete = () => { setConfirmDelete(false); window.requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(".screen-replay__delete")?.focus()); };
  const dismissDialog = () => { if (busy && confirmDelete) return; if (confirmDelete) cancelDelete(); else onClose(); };
  const dismiss = useOverlayDismiss(dismissDialog);
  useModalFocusTrap(dialog, { initialFocusSelector: ".modal-x" });
  useLayoutEffect(() => { if (confirmDelete) dialog.current?.querySelector<HTMLButtonElement>(".screen-replay__confirm button")?.focus(); }, [confirmDelete]);
  useLayoutEffect(() => {
    if (snapshot.generation === initialGeneration.current) return;
    setRows(null); setDetail(null);
    if (snapshot.generation === mutationGeneration.current) initialGeneration.current = snapshot.generation;
    else invalidateRef.current();
  }, [snapshot.generation]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; listRequest.current += 1; readRequest.current += 1; if (readTimer.current) clearTimeout(readTimer.current); }; }, []);

  const read = useCallback(async (recordId: string) => {
    const issued = ++readRequest.current; setReading(true); setFailed(false);
    try {
      await client.consume("screen_context_read_evidence", { recordId, includeFrame: true }, decodeScreenDetail, (value, generation) => {
        if (alive.current && issued === readRequest.current) setDetail({ value, generation });
      });
    } catch { if (alive.current && issued === readRequest.current) setFailed(true); }
    finally { if (alive.current && issued === readRequest.current) setReading(false); }
  }, [client]);
  const load = useCallback(async (preferId: string | null) => {
    const issued = ++listRequest.current; setLoading(true); setFailed(false);
    try {
      await loadScreenEvidenceRows(client, sourceRef.current, (value, generation) => {
        if (!alive.current || issued !== listRequest.current) return;
        setRows({ value, generation });
        const preferred = preferId ? value.findIndex((row) => row.id === preferId) : -1;
        const next = preferred >= 0 ? preferred : sourceRef.current.kind === "recent" ? value.length - 1 : 0;
        setIndex(Math.max(0, next));
        if (value[next]) void read(value[next].id); else setDetail(null);
      });
    } catch { if (alive.current && issued === listRequest.current) setFailed(true); }
    finally { if (alive.current && issued === listRequest.current) setLoading(false); }
  }, [client, read]);
  useEffect(() => { void load(initialRecordId); }, [load, initialRecordId]);

  // A status read keeps the lease honest while the viewer is open.
  useEffect(() => {
    let stopped = false; let inFlight = false;
    const poll = async () => {
      if (inFlight || stopped || mutationGeneration.current !== null) return; inFlight = true;
      try { await client.consume("screen_context_get_status", {}, decodeScreenStatus, () => {}); }
      catch { if (!stopped) { setDetail(null); setRows(null); setFailed(true); } }
      finally { inFlight = false; }
    };
    const timer = setInterval(() => { void poll(); }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [client]);

  const visibleRows = rows && client.canDisplay(rows.generation) ? rows.value : null;
  const current = visibleRows?.[index] ?? null;
  const visible = detail && client.canDisplay(detail.generation) && detail.value && detail.value.expiresAtMs > Date.now() ? detail.value : null;
  const currentId = current?.id ?? null;
  useEffect(() => {
    const expiries = [...(rows?.value.map((row) => row.expiresAtMs) ?? []), ...(detail?.value ? [detail.value.expiresAtMs] : [])];
    if (!expiries.length) return;
    const timer = setTimeout(() => { setDetail(null); void load(currentId); }, Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [rows, detail, load, currentId]);

  const goTo = (next: number) => {
    if (!visibleRows || next < 0 || next >= visibleRows.length || next === index) return;
    setIndex(next); setDeleted(false);
    if (readTimer.current) clearTimeout(readTimer.current);
    const id = visibleRows[next].id;
    readTimer.current = setTimeout(() => { void read(id); }, 120);
  };
  const remove = async () => {
    if (!current || busy) return;
    const recordId = current.id;
    const neighbor = visibleRows?.[index + 1]?.id ?? visibleRows?.[index - 1]?.id ?? null;
    setBusy(true); setFailed(false);
    mutationGeneration.current = client.getSnapshot().generation + 1;
    try {
      await client.mutate("screen_context_delete_evidence", { recordId, startMs: null, endMs: null }, decodeScreenDeletion, () => {
        if (alive.current) setDeleted(true);
      });
      if (alive.current) { setConfirmDelete(false); setDetail(null); await load(neighbor); }
    } catch { if (alive.current) { setConfirmDelete(false); setFailed(true); } }
    finally { mutationGeneration.current = null; if (alive.current) setBusy(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (confirmDelete || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.matches("input, select, textarea")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
  };

  const total = visibleRows?.length ?? 0;
  const first = visibleRows?.[0] ?? null;
  const last = visibleRows?.[total - 1] ?? null;
  const firstDate = first ? new Date(first.observedAtMs) : null;
  const lastDate = last ? new Date(last.observedAtMs) : null;
  // Recent screens can span yesterday and today within their 24-hour lifetime.
  const showDate = source.kind === "recent" || Boolean(firstDate && lastDate && firstDate.toDateString() !== lastDate.toDateString());
  const showYear = Boolean(firstDate && lastDate && firstDate.getFullYear() !== lastDate.getFullYear());
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    ...(showDate ? { month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}) } : {}),
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
  const clock = (ms: number) => timeFormatter.format(new Date(ms));
  const tickCount = Math.min(total, MAX_TICKS);
  // A screen kept without its image has only its text to show.
  const textOpen = Boolean(visible) && (showText || !visible?.frameUrl);
  const textBody = visible?.textEvidence.text.replace(/\r\n?/g, "\n") ?? "";
  const textState = visible?.textEvidence.state;
  const textMessage = textState === "not_requested" ? t("screenContext.textNotRequested") : textState === "deadline" ? t("screenContext.textDeadline")
    : textState === "unavailable" ? t("screenContext.textUnavailable") : t("screenContext.noText");

  return <ModalPresence onDismiss={dismissDialog} dismissDisabled={busy && confirmDelete}><div className="auth-modal__overlay screen-replay__overlay" {...dismiss}>
    <section ref={dialog} className="auth-modal modal-shell screen-replay" data-modal-variant="workspace" role="dialog" aria-modal="true"
      aria-labelledby="screen-replay-title" onClick={(event) => event.stopPropagation()} onKeyDown={onKeyDown} data-text-open={textOpen || undefined}>
      <ModalCloseButton label={t("screenRecording.viewer.close")} onClick={dismissDialog} disabled={busy && confirmDelete} />
      <header className="modal-head"><div className="modal-head__copy">
        <h2 id="screen-replay-title">{title}</h2>{subtitle ? <p>{subtitle}</p> : null}
      </div></header>
      <div className="screen-replay__body">
        <div className="screen-replay__stage" aria-busy={loading || reading}>
          {failed ? <div className="screen-replay__state" role="alert"><p>{t("screenRecording.viewer.failed")}</p>
            <button type="button" className="modal-btn" disabled={busy} onClick={() => void load(currentId)}>{t("screenRecording.viewer.retry")}</button></div>
            : !visibleRows ? <div className="screen-replay__state" role="status">{t("screenRecording.preview.loading")}</div>
            : total === 0 ? <div className="screen-replay__state" role="status">{deleted ? <p>{t("screenRecording.viewer.deleted")}</p> : null}<p>{t(source.kind === "recent" ? "screenRecording.viewer.emptyRecent" : "screenRecording.viewer.empty")}</p></div>
            : visible?.frameUrl ? <img className="screen-replay__image" data-stale={reading || undefined} src={visible.frameUrl} alt={t("screenContext.savedWindow")} />
            : visible ? <div className="screen-replay__state"><p>{t("screenRecording.viewer.noImage")}</p></div>
            : <div className="screen-replay__state" role="status">{t("screenRecording.preview.loading")}</div>}
        </div>
        {textOpen && visible ? <aside className="screen-replay__text" aria-label={t("screenRecording.viewer.textTitle")}>
          <h3>{t("screenRecording.viewer.textTitle")}</h3>
          {textState === "recognized" ? <pre>{textBody}</pre> : <p className="desc">{textMessage}</p>}
        </aside> : null}
      </div>
      {current && first && last ? <div className="screen-replay__timeline">
        <button type="button" className="screen-replay__nav" data-direction="previous" aria-label={t("screenRecording.viewer.previous")} disabled={index <= 0 || busy} onClick={() => goTo(index - 1)}><Chevron direction="left" /></button>
        <span className="screen-replay__edge">{clock(first.observedAtMs)}</span>
        <div className="screen-replay__track">
          <div className="screen-replay__ticks" aria-hidden="true">{Array.from({ length: tickCount }, (_, tick) => <span key={tick} />)}</div>
          <input type="range" min={0} max={Math.max(0, total - 1)} step={1} value={index} disabled={busy || total < 2}
            aria-label={t("screenRecording.viewer.timeline")} aria-valuetext={clock(current.observedAtMs)}
            onChange={(event) => goTo(Number(event.currentTarget.value))} />
        </div>
        <span className="screen-replay__edge">{clock(last.observedAtMs)}</span>
        <button type="button" className="screen-replay__nav" data-direction="next" aria-label={t("screenRecording.viewer.next")} disabled={index >= total - 1 || busy} onClick={() => goTo(index + 1)}><Chevron direction="right" /></button>
      </div> : null}
      <footer className="modal-foot screen-replay__foot">
        {confirmDelete ? <div className="screen-replay__confirm" role="group" aria-labelledby="screen-replay-delete-title">
          <div><strong id="screen-replay-delete-title">{t("screenRecording.viewer.deleteTitle")}</strong><p>{t("screenRecording.viewer.deleteBody")}</p></div>
          <div className="screen-replay__confirm-actions">
            <button type="button" className="modal-btn" disabled={busy} onClick={cancelDelete}>{t("screenRecording.delete.cancel")}</button>
            <button type="button" className="modal-btn modal-btn--danger" disabled={busy} aria-busy={busy} onClick={() => void remove()}>{t("screenRecording.delete.confirm")}</button>
          </div>
        </div> : total === 0 ? <span className="screen-replay__position" aria-live="polite">{deleted ? t("screenRecording.viewer.deleted") : null}</span> : <>
          <button type="button" className="modal-btn modal-btn--ghost screen-replay__delete" disabled={!visible || busy} onClick={() => setConfirmDelete(true)}>{t("screenRecording.viewer.delete")}</button>
          <span className="screen-replay__position" aria-live="polite">{deleted ? t("screenRecording.viewer.deleted")
            : current ? <><time dateTime={new Date(current.observedAtMs).toISOString()}>{clock(current.observedAtMs)}</time> · {t("screenRecording.viewer.position", { index: index + 1, total })}</> : null}</span>
          {visible?.frameUrl ? <button type="button" className="modal-btn" aria-pressed={showText} onClick={() => setShowText((value) => !value)}>
            {showText ? t("screenRecording.viewer.hideText") : t("screenRecording.viewer.showText")}</button> : <span className="screen-replay__foot-spacer" />}
        </>}
      </footer>
    </section>
  </div></ModalPresence>;
}
