import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { FEEDBACK_CATEGORY_OPTIONS, submitFeedback, type FeedbackAttachment, type FeedbackCategory } from "./feedbackService";

const MESSAGE_MAX_LENGTH = 3_000;
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
  const [email, setEmail] = useState(initialEmail?.trim() ?? "");
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => revokeAllPreviewUrls(previewUrlsRef);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || isSent) return;

    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError("Write a short note before sending feedback.");
      return;
    }

    if (!trimmedEmail) {
      setError("Enter an email address so we can follow up.");
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email address, like name@example.com.");
      return;
    }

    setError(null);
    setIsSending(true);

    let preparedAttachments: FeedbackAttachment[];
    try {
      preparedAttachments = await Promise.all(attachments.map(({ file }) => readAttachmentFile(file)));
    } catch {
      setIsSending(false);
      setError("Unable to read the selected image. Remove it and try again.");
      return;
    }

    const result = await submitFeedback({
      email: trimmedEmail,
      category,
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

    setError(result.error);
  }

  function handleOverlayClick() {
    if (!isSending) onClose();
  }

  function handleSendAnother() {
    setIsSent(false);
    setError(null);
    setCategory("idea");
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
        validationError = `Attach up to ${MAX_ATTACHMENTS} images.`;
        break;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        validationError = `${file.name} is larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`;
        continue;
      }

      if (!ALLOWED_ATTACHMENT_TYPES.has(getAttachmentContentType(file))) {
        validationError = `${file.name} is not a supported image type.`;
        continue;
      }

      if (totalBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        validationError = `Keep images under ${formatFileSize(MAX_ATTACHMENT_TOTAL_BYTES)} total.`;
        break;
      }

      const previewUrl = createPreviewUrl(file, previewUrlsRef);
      acceptedAttachments.push({ id: createAttachmentId(file, attachments.length + acceptedAttachments.length), file, previewUrl });
      totalBytes += file.size;
    }

    if (acceptedAttachments.length > 0) {
      setAttachments((current) => [...current, ...acceptedAttachments]);
    }
    setError(validationError);
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
    <div className="auth-modal__overlay" onClick={handleOverlayClick}>
      <section
        className="auth-modal feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header feedback-modal__header">
          <h2 id="feedback-modal-title">{isSent ? "Feedback sent" : "Send feedback"}</h2>
        </div>

        {error ? <p className="auth-modal__error" role="alert">{error}</p> : null}

        {isSent ? (
          <div className="feedback-modal__sent" role="status">
            <span className="label-mono">Received</span>
            <strong>We got your feedback.</strong>
            <p>If we need more detail, we&apos;ll reply to {email.trim()}.</p>
          </div>
        ) : null}

        {isSent ? null : (
          <form className="feedback-modal__form" onSubmit={handleSubmit} noValidate>
            <label className="feedback-modal__field" htmlFor="feedback-message">
              <span>Message</span>
              <textarea
                id="feedback-message"
                className="feedback-modal__textarea"
                required
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What should we know?"
                maxLength={MESSAGE_MAX_LENGTH}
                disabled={isSending}
                autoFocus
              />
            </label>

            <div className="feedback-modal__message-tools">
              <label className={`feedback-modal__image-button${isSending || attachments.length >= MAX_ATTACHMENTS ? " is-disabled" : ""}`}>
                <span className="sr-only">Add images</span>
                <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                  <path d="M4.75 3.5h10.5A2.25 2.25 0 0 1 17.5 5.75v8.5a2.25 2.25 0 0 1-2.25 2.25H4.75a2.25 2.25 0 0 1-2.25-2.25v-8.5A2.25 2.25 0 0 1 4.75 3.5Zm0 1.5a.75.75 0 0 0-.75.75v6.64l2.36-2.36a1.25 1.25 0 0 1 1.77 0l1.12 1.12 2.62-2.62a1.25 1.25 0 0 1 1.77 0L16 10.89V5.75a.75.75 0 0 0-.75-.75H4.75Zm9 2.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z" />
                </svg>
                <input
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  multiple
                  onChange={handleAttachmentsSelected}
                  disabled={isSending || attachments.length >= MAX_ATTACHMENTS}
                />
              </label>
              <span>{message.length}/{MESSAGE_MAX_LENGTH}</span>
            </div>

            {attachments.length > 0 ? (
              <div className="feedback-modal__images">
                <ul className="feedback-modal__image-list" aria-label="Selected images">
                  {attachments.map((attachment) => (
                    <li className="feedback-modal__image-chip" key={attachment.id}>
                      {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" aria-hidden="true" /> : <span aria-hidden="true">IMG</span>}
                      <div>
                        <strong>{attachment.file.name}</strong>
                        <small>{formatFileSize(attachment.file.size)}</small>
                      </div>
                      <button type="button" onClick={() => removeAttachment(attachment.id)} disabled={isSending} aria-label={`Remove ${attachment.file.name}`}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <fieldset className="feedback-modal__categories">
              <legend>Category</legend>
              <div className="settings-mode-switch settings-mode-switch--triple feedback-modal__category-list">
                {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className={`settings-mode-option feedback-modal__category${category === option.id ? " is-active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="feedback-category"
                      value={option.id}
                      checked={category === option.id}
                      onChange={() => setCategory(option.id)}
                      disabled={isSending}
                      required
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="feedback-modal__field" htmlFor="feedback-email">
              <span>Email</span>
              <input
                id="feedback-email"
                className="settings-input feedback-modal__input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                disabled={isSending}
              />
            </label>

            <div className="feedback-modal__actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={isSending}>
                Cancel
              </button>
              <button type="submit" className="settings-btn feedback-modal__primary" disabled={isSending}>
                {isSending ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </form>
        )}

        {isSent ? (
          <div className="feedback-modal__actions">
            <button type="button" className="ghost-button" onClick={handleSendAnother}>
              Send another
            </button>
            <button type="button" className="settings-btn feedback-modal__primary" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
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
