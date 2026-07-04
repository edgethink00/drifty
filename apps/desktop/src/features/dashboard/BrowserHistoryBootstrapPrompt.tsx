export type BrowserHistoryBootstrapNoticeModel = {
  readonly detail: string;
  readonly statusLabel: string | null;
  readonly tone: "working" | "success" | "neutral" | "error";
};

type BrowserHistoryBootstrapNoticeProps = {
  readonly notice: BrowserHistoryBootstrapNoticeModel;
};

export function BrowserHistoryBootstrapNotice({ notice }: BrowserHistoryBootstrapNoticeProps) {
  return (
    <div className={`browser-history-bootstrap browser-history-bootstrap--${notice.tone}`}>
      {notice.statusLabel ? (
        <span className="browser-history-bootstrap__status" role="status">
          {notice.statusLabel}
        </span>
      ) : null}
    </div>
  );
}
