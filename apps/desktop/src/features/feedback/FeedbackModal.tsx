import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { submitFeedback, type FeedbackAttachment } from "./feedbackService";

const MESSAGE_MAX_LENGTH = 3_000;
const COUNTER_REVEAL_REMAINING = 300;
const COUNTER_WARN_REMAINING = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif";
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type AttachmentDraft = {
  id: string;
  file: File;
  previewUrl: string | null;
};

type FeedbackModalProps = {
  initialEmail?: string | null;
  onClose: () => void;
};

export function FeedbackModal({ initialEmail, onClose }: FeedbackModalProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [email, setEmail] = useState(initialEmail?.trim() ?? "");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; message?: string }>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  useModalDismiss(onClose, { disabled: isSending });
  const dialogRef = useRef<HTMLElement | null>(null);
  useAnchoredDialog(dialogRef);
  const emailPrefilled = Boolean(initialEmail?.trim());
  // A sent form has nothing left to lose; until then a draft survives a stray click.
  const hasUnsavedInput = !isSent && (
    message.trim().length > 0
    || attachments.length > 0
    || email.trim() !== (initialEmail?.trim() ?? "")
  );
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: isSending, keepOpen: hasUnsavedInput });

  useEffect(() => {
    return () => revokeAllPreviewUrls(previewUrlsRef);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || isSent) return;

    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setFieldErrors({ message: t("feedback.error.messageRequired") });
      setFormError(null);
      messageInputRef.current?.focus();
      return;
    }

    if (!trimmedEmail) {
      setFieldErrors({ email: t("feedback.error.emailRequired") });
      setFormError(null);
      emailInputRef.current?.focus();
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFieldErrors({ email: t("feedback.error.emailInvalid") });
      setFormError(null);
      emailInputRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setIsSending(true);

    let preparedAttachments: FeedbackAttachment[];
    try {
      preparedAttachments = await Promise.all(attachments.map(({ file }) => readAttachmentFile(file)));
    } catch {
      setIsSending(false);
      setAttachmentError(t("feedback.error.readImage"));
      return;
    }

    const result = await submitFeedback({
      email: trimmedEmail,
      message: trimmedMessage,
      attachments: preparedAttachments,
    });

    setIsSending(false);
    if (result.success) {
      setIsSent(true);
      setMessage("");
      clearAttachments();
      return;
    }

    setFormError(localizeFeedbackServiceError(result.error, effectiveLanguage, t));
  }

  function handleSendAnother() {
    setIsSent(false);
    setFieldErrors({});
    setAttachmentError(null);
    setFormError(null);
    setMessage("");
    clearAttachments();
  }

  function handleAttachmentsSelected(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;

    const acceptedAttachments: AttachmentDraft[] = [];
    let totalBytes = getAttachmentTotalBytes(attachments);
    let validationError: string | null = null;

    for (const file of selectedFiles) {
      if (attachments.length + acceptedAttachments.length >= MAX_ATTACHMENTS) {
        validationError = t("feedback.error.maxImages", { count: MAX_ATTACHMENTS });
        break;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        validationError = t("feedback.error.fileTooLarge", { name: file.name, size: formatFileSize(MAX_ATTACHMENT_BYTES) });
        continue;
      }

      if (!ALLOWED_ATTACHMENT_TYPES.has(getAttachmentContentType(file))) {
        validationError = t("feedback.error.unsupportedImage", { name: file.name });
        continue;
      }

      if (totalBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        validationError = t("feedback.error.totalTooLarge", { size: formatFileSize(MAX_ATTACHMENT_TOTAL_BYTES) });
        break;
      }

      const previewUrl = createPreviewUrl(file, previewUrlsRef);
      acceptedAttachments.push({ id: createAttachmentId(file, attachments.length + acceptedAttachments.length), file, previewUrl });
      totalBytes += file.size;
    }

    if (acceptedAttachments.length > 0) {
      setAttachments((current) => [...current, ...acceptedAttachments]);
    }
    setAttachmentError(validationError);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === id);
      if (attachment?.previewUrl) revokePreviewUrl(attachment.previewUrl, previewUrlsRef);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearAttachments() {
    revokeAllPreviewUrls(previewUrlsRef);
    setAttachments([]);
  }

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell feedback-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton disabled={isSending} label={t("feedback.close")} onClick={() => { if (!isSending) onClose(); }} />
        <div className="modal-head feedback-modal__header">
          <div className="modal-head__copy">
            <h2 id="feedback-modal-title">{isSent ? t("feedback.sentTitle") : t("feedback.title")}</h2>
            {isSent ? null : <p>{t("feedback.description")}</p>}
          </div>
        </div>

        {isSent ? (
          <div className="feedback-modal__sent" role="status">
            <span className="label-mono">{t("feedback.received")}</span>
            <strong>{t("feedback.receivedTitle")}</strong>
            <p>{t("feedback.followUp", { email: email.trim() })}</p>
          </div>
        ) : null}

        {isSent ? null : (
          <form className="feedback-modal__form" onSubmit={handleSubmit} noValidate>
            <div className="feedback-modal__field">
              <label className="feedback-modal__label" htmlFor="feedback-email">{t("feedback.email")}</label>
              <input
                id="feedback-email"
                className={`feedback-modal__input${fieldErrors.email ? " is-invalid" : ""}`}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
                }}
                placeholder={t("feedback.emailPlaceholder")}
                disabled={isSending}
                ref={emailInputRef}
                autoFocus={!emailPrefilled}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? "feedback-email-error" : undefined}
              />
              {fieldErrors.email ? (
                <p className="feedback-modal__field-error" id="feedback-email-error" role="alert">{fieldErrors.email}</p>
              ) : null}
            </div>

            <div className="feedback-modal__field">
              <div className="feedback-modal__message-wrap">
                <textarea
                  id="feedback-message"
                  className={`feedback-modal__textarea${fieldErrors.message ? " is-invalid" : ""}`}
                  aria-label={t("feedback.messageAria")}
                  required
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (fieldErrors.message) setFieldErrors((current) => ({ ...current, message: undefined }));
                  }}
                  placeholder={t("feedback.messagePlaceholder")}
                  maxLength={MESSAGE_MAX_LENGTH}
                  disabled={isSending}
                  ref={messageInputRef}
                  autoFocus={emailPrefilled}
                  aria-invalid={fieldErrors.message ? true : undefined}
                  aria-describedby={fieldErrors.message ? "feedback-message-error" : undefined}
                />
                {message.length >= MESSAGE_MAX_LENGTH - COUNTER_REVEAL_REMAINING ? (
                  <span className={`feedback-modal__counter${message.length >= MESSAGE_MAX_LENGTH - COUNTER_WARN_REMAINING ? " is-warn" : ""}`}>
                    {message.length}/{MESSAGE_MAX_LENGTH}
                  </span>
                ) : null}
              </div>
              {fieldErrors.message ? (
                <p className="feedback-modal__field-error" id="feedback-message-error" role="alert">{fieldErrors.message}</p>
              ) : null}
            </div>

            {attachments.length > 0 ? (
              <div className="feedback-modal__images">
                <ul className="feedback-modal__image-list" aria-label={t("feedback.selectedImages")}>
                  {attachments.map((attachment) => (
                    <li className="feedback-modal__image-chip" key={attachment.id}>
                      {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" aria-hidden="true" /> : <span aria-hidden="true">{t("feedback.imageFallback")}</span>}
                      <div>
                        <strong>{attachment.file.name}</strong>
                        <small>{formatFileSize(attachment.file.size)}</small>
                      </div>
                      <button type="button" onClick={() => removeAttachment(attachment.id)} disabled={isSending} aria-label={t("feedback.removeImage", { name: attachment.file.name })}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {attachmentError ? (
              <p className="feedback-modal__field-error feedback-modal__attachment-error" role="alert">{attachmentError}</p>
            ) : null}

            <div className="modal-foot feedback-modal__actions">
              <div className="feedback-modal__attach-group">
                <label
                  className={`modal-btn modal-btn--ghost feedback-modal__attach${isSending || attachments.length >= MAX_ATTACHMENTS ? " is-disabled" : ""}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{t("feedback.attachImages")}</span>
                  <input
                    type="file"
                    accept={ATTACHMENT_ACCEPT}
                    multiple
                    onChange={handleAttachmentsSelected}
                    disabled={isSending || attachments.length >= MAX_ATTACHMENTS}
                  />
                </label>
              </div>
              {formError ? <p className="modal-foot__note modal-foot__note--error" role="alert" title={formError}>{formError}</p> : null}
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose} disabled={isSending}>
                {t("common.cancel")}
              </button>
              {/* "Sending…" is far wider than "Send": the spinner takes the
                  button over instead, and the progress text goes to assistive
                  technology only. */}
              {isSending ? <span className="action-status" role="status">{t("feedback.sending")}</span> : null}
              <button type="submit" className="modal-btn modal-btn--primary" disabled={isSending} aria-busy={isSending}>
                <ActionLabel busy={isSending}>{t("feedback.send")}</ActionLabel>
              </button>
            </div>
          </form>
        )}

        {isSent ? (
          <div className="modal-foot feedback-modal__actions">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={handleSendAnother}>
              {t("feedback.sendAnother")}
            </button>
            <button type="button" className="modal-btn modal-btn--primary" onClick={onClose} autoFocus>
              {t("feedback.closeAction")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function localizeFeedbackServiceError(
  error: string,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return error;
  switch (error) {
    case "Write a short note before sending feedback.": return t("feedback.error.messageRequired");
    case "Enter an email address so we can follow up.": return t("feedback.error.emailRequired");
    case "Enter a valid email address, like name@example.com.": return t("feedback.error.emailInvalid");
    case "Feedback sending is not configured in this build.":
    case "Unable to send feedback right now.":
      return t("feedback.error.send");
    default:
      return t("feedback.error.sendWithDetail", { detail: error });
  }
}

function createAttachmentId(file: File, index: number) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function createPreviewUrl(file: File, previewUrlsRef: { current: string[] }) {
  if (!getAttachmentContentType(file).startsWith("image/") || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const previewUrl = URL.createObjectURL(file);
  previewUrlsRef.current.push(previewUrl);
  return previewUrl;
}

function revokePreviewUrl(previewUrl: string, previewUrlsRef: { current: string[] }) {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewUrl);
  previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== previewUrl);
}

function revokeAllPreviewUrls(previewUrlsRef: { current: string[] }) {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const previewUrl of previewUrlsRef.current) URL.revokeObjectURL(previewUrl);
  }
  previewUrlsRef.current = [];
}

function getAttachmentTotalBytes(attachments: AttachmentDraft[]) {
  return attachments.reduce((total, attachment) => total + attachment.file.size, 0);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${Math.ceil(size / (1024 * 1024))} MB`;
}

function readAttachmentFile(file: File): Promise<FeedbackAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read attachment"));
        return;
      }

      const [, content = ""] = reader.result.split(",");
      resolve({
        filename: file.name,
        contentType: getAttachmentContentType(file),
        content,
        size: file.size,
      });
    });
    reader.addEventListener("error", () => reject(new Error("Unable to read attachment")));
    reader.readAsDataURL(file);
  });
}

function getAttachmentContentType(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return "application/octet-stream";
}
