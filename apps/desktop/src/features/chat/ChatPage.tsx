import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { AnchoredPresence } from "../../components/AnchoredPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { BUILD_INFO } from "../../buildInfo";
import { copyTextToClipboard } from "../../lib/clipboard";
import { readProductAnalyticsEnabled } from "../../lib/analytics/productAnalyticsPreference";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { SettingsSelect, type SettingsSelectOption } from "../settings/SettingsSelect";
import { createChatClient, type ChatClient, type ChatDroppedFile } from "./chatClient";
import {
  ChatCloudError,
  readChatCloudStatus,
  recordChatTurn,
  runChatCloudTurn,
  sendChatTurnFeedback,
  watchChatCloudAccount,
  type ChatCloudAccountWatch,
  type ChatCloudModelKey,
  type ChatCloudModelOption,
  type ChatCloudStatus,
} from "./chatCloudClient";
import {
  CHAT_ATTACHMENT_ACCEPT,
  ChatAttachmentReadError,
  chatAttachmentKind,
  composeChatRequest,
  MAX_CHAT_ATTACHMENTS,
  readChatAttachment,
  type ChatAttachment,
  type ChatAttachmentKind,
  type ChatAttachmentMeta,
} from "./chatAttachments";
import { CHAT_CLI_DEFAULTS, CHAT_CLI_EFFORT_LABELS, CHAT_CLI_EFFORTS, CHAT_CLI_FORMER_MODEL_IDS, CHAT_CLI_MODELS, isChatCliEffort, type ChatCliSelection } from "./chatCliModels";
import { CHAT_COPY, chatLanguage, chatLocale, type ChatCopy, type ChatLanguage } from "./chatCopy";
import { buildChatInstructions, buildChatPrompt } from "./chatPrompt";
import {
  chatConversationTitle,
  readChatConversations,
  removeChatConversation,
  upsertChatConversation,
  writeChatConversations,
} from "./chatStore";
import { chatStreamAnswer, EMPTY_CHAT_STREAM, reduceChatStreamLine } from "./chatStream";
import { chatTasks, filterChatTasks, splitAnswerSuggestions, visibleAnswerText, type ChatTask, type ChatTaskIcon } from "./chatSuggestions";
import type { ChatConnection, ChatConversation, ChatFeedback, ChatProvider, ChatRuntimeStatus, ChatToolStep, ChatTurn } from "./chatTypes";
import "./chat.css";

export const CHAT_CONNECTION_STORAGE_KEY = "drifty.chat.connection";
export const CHAT_CLOUD_MODEL_STORAGE_KEY = "drifty.chat.cloudModel";
const EMPTY_STATE_TASKS = 6;
const COPIED_FEEDBACK_MS = 1600;

type CloudInvoke = Parameters<typeof readChatCloudStatus>[0];

/** Ids are UUIDs because Drifty Cloud keys credits and saved chats by them. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-" + ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20) + "-" + hex.slice(20);
}

function readConnection(): ChatConnection {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_CONNECTION_STORAGE_KEY);
    return stored === "claude" || stored === "cloud" ? stored : "codex";
  } catch {
    return "codex";
  }
}

export const CHAT_CLI_CHOICE_STORAGE_KEY = "drifty.chat.cliChoice.v1";
type ChatCliChoices = Readonly<Record<ChatProvider, ChatCliSelection>>;

/** The model and effort remembered for each CLI; anything missing or unknown is that CLI's default. */
function readCliChoices(): ChatCliChoices {
  const choices: Record<ChatProvider, ChatCliSelection> = { ...CHAT_CLI_DEFAULTS };
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(CHAT_CLI_CHOICE_STORAGE_KEY) ?? "{}");
    for (const provider of ["codex", "claude"] as const) {
      const entry = stored && typeof stored === "object" ? (stored as Record<string, unknown>)[provider] : null;
      if (!entry || typeof entry !== "object") continue;
      const { model: storedModel, effort } = entry as Record<string, unknown>;
      const model = typeof storedModel === "string" ? CHAT_CLI_FORMER_MODEL_IDS[provider]?.[storedModel] ?? storedModel : null;
      choices[provider] = {
        model: model && CHAT_CLI_MODELS[provider].some((option) => option.id === model) ? model : CHAT_CLI_DEFAULTS[provider].model,
        effort: isChatCliEffort(effort) ? effort : CHAT_CLI_DEFAULTS[provider].effort,
      };
    }
  } catch {
    // A damaged entry only resets the choice to the default.
  }
  return choices;
}

type PendingAttachment = {
  readonly id: string;
  readonly name: string;
  readonly kind: ChatAttachmentKind | null;
  readonly status: "reading" | "ready" | "error";
  readonly attachment?: ChatAttachment;
  readonly error?: string;
};

function hasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes("Files"));
}

/** A picked, pasted or page-dropped File, or a file dropped on the app window. */
type ChatFileSource = File | ChatDroppedFile;

function isDroppedFile(source: ChatFileSource): source is ChatDroppedFile {
  return typeof (source as ChatDroppedFile).read === "function";
}

function readSource(source: ChatFileSource): Promise<ChatAttachment> {
  if (!isDroppedFile(source)) return readChatAttachment(source);
  // Skip reading a file whose format Chat can't use anyway.
  if (!chatAttachmentKind({ name: source.name, type: "" })) return Promise.reject(new ChatAttachmentReadError("unsupported"));
  return source.read().then(readChatAttachment);
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.25 2.25H4.75a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5V5.75Z" /><path d="M9.25 2.25v3.5h3.5" /></svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.6 7.6 7.9 12.3a3.1 3.1 0 0 1-4.4-4.4l5.2-5.2a2.07 2.07 0 0 1 2.93 2.93L6.4 10.85a1.03 1.03 0 0 1-1.46-1.46l4.6-4.6" /></svg>
  );
}

function EffortIcon() {
  return (
    <svg className="chat-picker__icon" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.75 10.75a5.25 5.25 0 1 1 10.5 0" /><path d="M8 10.75l2.4-3.4" /></svg>
  );
}

function readCloudModel(): ChatCloudModelKey | null {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_CLOUD_MODEL_STORAGE_KEY);
    return stored === "sonnet" || stored === "haiku" || stored === "opus" || stored === "fable" ? stored : null;
  } catch {
    return null;
  }
}

/** The chat open in this app session: leaving Chat and coming back keeps it, while a new launch starts a new chat. */
const CHAT_ACTIVE_SESSION_KEY = "drifty.chat.active.v1";

function readSessionChatId(conversations: readonly ChatConversation[]): string | null {
  try {
    const id = globalThis.sessionStorage?.getItem(CHAT_ACTIVE_SESSION_KEY);
    return id && conversations.some((conversation) => conversation.id === id) ? id : null;
  } catch {
    return null;
  }
}

function writeSessionChatId(id: string | null): void {
  try {
    if (id) globalThis.sessionStorage?.setItem(CHAT_ACTIVE_SESSION_KEY, id);
    else globalThis.sessionStorage?.removeItem(CHAT_ACTIVE_SESSION_KEY);
  } catch {
    // Session storage unavailable: Chat simply opens on a new chat next time.
  }
}

const NO_CLOUD_MODELS: readonly ChatCloudModelOption[] = [];

function cloudErrorMessage(error: ChatCloudError, copy: ChatCopy, modelLabel: string): string {
  switch (error.code) {
    // What is left below the chosen model's minimum reads as used up too (owner, 2026-10-25).
    case "credits_exhausted":
    case "credits_low_for_model": return copy.cloudErrorExhausted(error.credits?.renewsAt ?? null);
    case "model_not_in_plan": return copy.cloudErrorModelPro(modelLabel);
    case "plan_required": return copy.cloudPlanRequired;
    case "sign_in_required":
    case "full_account_required": return copy.cloudSignIn;
    case "model_unavailable": return copy.cloudErrorModelBusy;
    case "too_many_steps": return copy.cloudErrorTooManySteps;
    default: return error.message;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function lastMeaningfulLine(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("Reading additional input"));
  return lines.length > 0 ? lines[lines.length - 1] : null;
}

function dayLabel(value: unknown, locale: string): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function chatToolLabel(step: ChatToolStep, lang: ChatLanguage, copy: ChatCopy): string {
  const locale = chatLocale(lang);
  const day = dayLabel(step.args.day, locale);
  const from = dayLabel(step.args.from, locale);
  const to = dayLabel(step.args.to, locale);
  const range = day ?? (from && to ? (from === to ? from : from + "–" + to) : copy.allTime);
  if (step.name === "summary") return copy.toolSummary(range);
  if (step.name === "timeline") return copy.toolTimeline(range);
  if (step.name === "search") {
    const query = typeof step.args.query === "string" ? step.args.query.trim() : "";
    return query ? copy.toolSearch(query, range) : copy.toolSearchAll(range);
  }
  return step.name;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\u0060[^\u0060]+\u0060)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_PATTERN).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("\u0060") && part.endsWith("\u0060") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,4}\s+/;

/**
 * A small, safe subset of Markdown: paragraphs, headings, bullet lists, bold and
 * inline code. Within a block, consecutive list lines become one list and the
 * line right above a list reads as its label (as in a standup's three parts).
 */
export function ChatAnswerText({ text }: { readonly text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="chat-answer__text">
      {blocks.flatMap((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const out: ReactNode[] = [];
        let paragraph: string[] = [];
        let list: string[] = [];
        const flushParagraph = (labelsList: boolean) => {
          if (paragraph.length === 0) return;
          const lastIsLabel = labelsList && paragraph.length > 0;
          const body = lastIsLabel ? paragraph.slice(0, -1) : paragraph;
          if (body.length > 0) {
            out.push(
              <p key={index + "-p" + out.length}>
                {body.map((line, item) => <span key={item}>{item > 0 ? <br /> : null}{renderInline(line)}</span>)}
              </p>,
            );
          }
          if (lastIsLabel) out.push(<p key={index + "-l" + out.length} className="chat-answer__heading">{renderInline(paragraph[paragraph.length - 1])}</p>);
          paragraph = [];
        };
        const flushList = () => {
          if (list.length === 0) return;
          out.push(<ul key={index + "-u" + out.length}>{list.map((line, item) => <li key={item}>{renderInline(line.replace(LIST_ITEM, ""))}</li>)}</ul>);
          list = [];
        };
        for (const line of lines) {
          if (HEADING.test(line)) {
            flushList();
            flushParagraph(false);
            out.push(<p key={index + "-h" + out.length} className="chat-answer__heading">{renderInline(line.replace(HEADING, ""))}</p>);
          } else if (LIST_ITEM.test(line)) {
            flushParagraph(true);
            list.push(line);
          } else {
            flushList();
            paragraph.push(line);
          }
        }
        flushList();
        flushParagraph(false);
        return out;
      })}
    </div>
  );
}

function ToolIcon({ status }: { readonly status: ChatToolStep["status"] }) {
  if (status === "running") return <span className="chat-step__spinner" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "done" ? <path d="M3.5 8.5l3 3 6-7" /> : <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
    </svg>
  );
}

const TASK_ICON_PATHS: Record<ChatTaskIcon, ReactNode> = {
  standup: <><path d="M4 2.75h6l2.5 2.5v8a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" /><path d="M5.75 7.5h4.5M5.75 10h3" /></>,
  today: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.25l2 1.25" /></>,
  week: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" /></>,
  compare: <><path d="M3 5.5h9M9.5 3l2.5 2.5L9.5 8" /><path d="M13 10.5H4M6.5 8L4 10.5 6.5 13" /></>,
  focus: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.25" /></>,
  drift: <><path d="M2.5 9c1.5-2.5 3-2.5 4.5 0s3 2.5 4.5 0" /><path d="M2.5 5.5c1.5-2.5 3-2.5 4.5 0s3 2.5 4.5 0" /></>,
  project: <><path d="M2.5 4.25a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" /></>,
};

function TaskIcon({ icon }: { readonly icon: ChatTaskIcon }) {
  return (
    <svg className="chat-task__icon" viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TASK_ICON_PATHS[icon]}
    </svg>
  );
}

function turnSeconds(turn: ChatTurn): number | null {
  if (!turn.finishedAt) return null;
  const elapsed = Date.parse(turn.finishedAt) - Date.parse(turn.startedAt);
  return Number.isFinite(elapsed) ? Math.max(1, Math.round(elapsed / 1000)) : null;
}

/** Tool steps and progress notes: live while running, one expandable line once the answer is in. */
function ChatSteps({ turn, lang, copy }: { readonly turn: ChatTurn; readonly lang: ChatLanguage; readonly copy: ChatCopy }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const running = turn.status === "running";
  const steps = turn.tools;
  if (steps.length === 0 && (running || turn.notes.length === 0)) return running ? <Notes notes={turn.notes} /> : null;
  const recovered = (index: number) => steps.slice(index + 1).some((later) => later.status === "done");
  const list = (
    <>
      {steps.length > 0 ? (
        <ul id={listId} className="chat-steps" aria-label={copy.stepsLabel}>
          {steps.map((step, index) => (
            <li key={step.id} className={"chat-step chat-step--" + step.status}>
              <ToolIcon status={step.status} />
              <span>{chatToolLabel(step, lang, copy)}</span>
              {step.status === "running" ? <span className="chat-step__state">{copy.toolRunning}</span> : null}
              {step.status === "failed" ? <span className="chat-step__state">{recovered(index) ? copy.toolRecovered : copy.toolFailed}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Notes notes={turn.notes} />
    </>
  );
  if (running) return list;
  const allFailed = steps.length > 0 && steps.every((step) => step.status === "failed");
  const seconds = turnSeconds(turn);
  const expanded = open || (allFailed && !turn.answer);
  return (
    <div className="chat-steps-summary">
      <button type="button" className="chat-steps-summary__toggle" aria-expanded={expanded} aria-controls={steps.length > 0 ? listId : undefined} onClick={() => setOpen((value) => !value)}>
        <ToolIcon status={allFailed ? "failed" : "done"} />
        <span>{steps.length > 0 ? copy.stepsSummary(steps.length, seconds ? copy.duration(seconds) : null) : (seconds ? copy.duration(seconds) : copy.stepsRunning)}</span>
        <svg className="chat-steps-summary__chevron" viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      </button>
      {expanded ? <div className="chat-steps-summary__body">{list}</div> : null}
    </div>
  );
}

function Notes({ notes }: { readonly notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return <>{notes.map((note, index) => <p key={index} className="chat-answer__note">{note}</p>)}</>;
}

/** Hover and keyboard-focus label for an icon-only button; the button keeps its own aria-label. */
function ChatTip({ side, children }: { readonly side: "top" | "bottom"; readonly children: ReactNode }) {
  return <span className="chat-tip" data-side={side} aria-hidden="true">{children}</span>;
}

function ConnectionIcon({ connection }: { readonly connection: ChatConnection }) {
  return connection === "cloud" ? (
    <svg className="chat-picker__icon" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.75 12.25h6.5a2.75 2.75 0 0 0 .4-5.47 4 4 0 0 0-7.66.86 2.31 2.31 0 0 0 .76 4.61Z" /></svg>
  ) : (
    <svg className="chat-picker__icon" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M5 6.5l1.75 1.5L5 9.5M8.5 10h2.5" /></svg>
  );
}

const FEEDBACK_MENU_ROOM = 112;

/** A thumb in a 24-unit box; the down thumb is the up thumb turned over. */
function Thumb({ down = false, filled = false }: { readonly down?: boolean; readonly filled?: boolean }) {
  return (
    <g transform={down ? "rotate(180 12 12)" : undefined}>
      <path vectorEffect="non-scaling-stroke" fill={filled ? "currentColor" : "none"} d="M3.5 10.25h3.5v9.5H3.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Z" />
      <path vectorEffect="non-scaling-stroke" fill={filled ? "currentColor" : "none"} d="M7 10.25 10.4 3.6a1.6 1.6 0 0 1 2.95 1.12L12.6 8.75h5.65a2 2 0 0 1 1.96 2.4l-1.42 7a2 2 0 0 1-1.96 1.6H7" />
    </g>
  );
}

function ThumbIcon({ down = false, filled = false }: { readonly down?: boolean; readonly filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <Thumb down={down} filled={filled} />
    </svg>
  );
}

/** Up and down thumbs in one glyph, as Codex shows before an answer is rated: drawn small, not scaled down. */
function ThumbsIcon() {
  const small = "M3 6.25 5.3 1.6a1.05 1.05 0 0 1 1.95.7L6.8 5.25H10a1.25 1.25 0 0 1 1.22 1.52l-1.07 4.98a1.25 1.25 0 0 1-1.22 1H3Zm0 0H.75a.5.5 0 0 0-.5.5v5.5a.5.5 0 0 0 .5.5H3";
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path vectorEffect="non-scaling-stroke" transform="translate(0.25 0.5)" d={small} />
      <path vectorEffect="non-scaling-stroke" transform="rotate(180 12 12) translate(0.25 0.5)" d={small} />
    </svg>
  );
}

function scrollAreaTop(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node.getBoundingClientRect().top;
  }
  return 0;
}

/** One thumbs button that opens 좋아요 / 별로예요; choosing the current rating again withdraws it. */
function ChatFeedbackButton({ rating, copy, onRate }: {
  readonly rating: ChatFeedback | null;
  readonly copy: ChatCopy;
  readonly onRate: (rating: ChatFeedback | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    // Opens above the button like Codex, unless the answer sits too close to the top to fit.
    if (trigger) setBelow(trigger.getBoundingClientRect().top - scrollAreaTop(trigger) < FEEDBACK_MENU_ROOM);
    itemRefs.current[rating === "bad" ? 1 : 0]?.focus({ preventScroll: true });
  }, [open, rating]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (value: ChatFeedback) => {
    onRate(value === rating ? null : value);
    close(true);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };
  const label = rating ? copy.feedbackGiven(rating) : copy.feedback;

  return (
    <div className="chat-feedback" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={"chat-icon-action" + (rating ? " is-rated" : "") + (open ? " is-open" : "")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {rating ? <ThumbIcon down={rating === "bad"} filled /> : <ThumbsIcon />}
        {open ? null : <ChatTip side="bottom">{label}</ChatTip>}
      </button>
      <AnchoredPresence>{open ? (
        <div className="chat-feedback__menu" id={menuId} role="menu" aria-label={copy.feedback} data-side={below ? "below" : "above"} onKeyDown={onMenuKeyDown}>
          {(["good", "bad"] as const).map((value, index) => (
            <button
              key={value}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitemradio"
              aria-checked={rating === value}
              className="chat-feedback__item"
              onClick={() => choose(value)}
            >
              <ThumbIcon down={value === "bad"} filled={rating === value} />
              <span>{value === "good" ? copy.feedbackGood : copy.feedbackBad}</span>
            </button>
          ))}
        </div>
      ) : null}</AnchoredPresence>
    </div>
  );
}

function ChatTurnView({ turn, lang, copy, onRetry, onRate, canRetry, isLast }: {
  readonly turn: ChatTurn;
  readonly lang: ChatLanguage;
  readonly copy: ChatCopy;
  readonly onRetry: (turn: ChatTurn) => void;
  readonly onRate: (turn: ChatTurn, rating: ChatFeedback | null) => void;
  readonly canRetry: boolean;
  readonly isLast: boolean;
}) {
  const running = turn.status === "running";
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyAnswer = () => {
    void copyTextToClipboard(turn.answer).then(() => setCopied(true), () => undefined);
  };
  return (
    <article className="chat-turn">
      <div className="chat-turn__question">{turn.question}</div>
      {turn.attachments && turn.attachments.length > 0 ? (
        <ul className="chat-turn__attachments" aria-label={copy.attachments}>
          {turn.attachments.map((attachment, index) => (
            <li key={attachment.name + index} className="chat-turn__attachment" title={attachment.truncated ? copy.attachTruncated : undefined}>
              <FileIcon />
              <span>{attachment.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chat-answer" aria-busy={running}>
        <ChatSteps turn={turn} lang={lang} copy={copy} />
        {turn.answer ? <ChatAnswerText text={turn.answer} /> : null}
        {running && !turn.answer ? (
          <p className="chat-answer__pending"><span className="chat-step__spinner" aria-hidden="true" />{turn.tools.length > 0 ? copy.thinking : copy.checking}</p>
        ) : null}
        {turn.status === "cancelled" ? <p className="chat-answer__note">{copy.stopped}</p> : null}
        {turn.status === "error" ? (
          <div className="chat-answer__error" role="alert">
            <p>{copy.errorPrefix}{turn.error ? " " + turn.error : ""}</p>
            {canRetry ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => onRetry(turn)}>{copy.retry}</button> : null}
          </div>
        ) : null}
        {turn.status === "done" && turn.answer ? (
          <div className={"chat-answer__actions" + (isLast ? "" : " chat-answer__actions--quiet")}>
            <button type="button" className={"chat-icon-action" + (copied ? " is-done" : "")} aria-label={copy.copyAnswer} onClick={copyAnswer}>
              {copied ? (
                <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.25" y="5.25" width="8.25" height="8.25" rx="1.75" /><path d="M10.75 3.25v-.25a.75.75 0 0 0-.75-.75H3a.75.75 0 0 0-.75.75v7c0 .41.34.75.75.75h.25" /></svg>
              )}
              <ChatTip side="bottom">{copied ? copy.copied : copy.copyAnswer}</ChatTip>
            </button>
            <span className="chat-sr-only" aria-live="polite">{copied ? copy.copied : ""}</span>
            <ChatFeedbackButton
              rating={turn.feedback === "good" || turn.feedback === "bad" ? turn.feedback : null}
              copy={copy}
              onRate={(rating) => onRate(turn, rating)}
            />
            {isLast && canRetry ? (
              <button type="button" className="chat-icon-action" aria-label={copy.retry} onClick={() => onRetry(turn)}>
                <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" /><path d="M13.5 2.5v2.75h-2.75" /></svg>
                <ChatTip side="bottom">{copy.retry}</ChatTip>
              </button>
            ) : null}
            {turn.connection === "cloud" && turn.charged !== undefined ? (
              <span className="chat-answer__meta">{(turn.model ? turn.model + " · " : "") + copy.creditsUsed(turn.charged)}</span>
            ) : turn.connection !== "cloud" && turn.model ? (
              <span className="chat-answer__meta">{turn.model}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ChatNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { effectiveLanguage, t } = useLocalization();
  const label = CHAT_COPY[chatLanguage(effectiveLanguage)].nav;
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
      <span>{label}</span>
      <span className="status-badge status-badge--beta chat-nav-badge" aria-hidden="true">{t("common.beta")}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
    </button>
  );
}

type ConversationGroup = { readonly key: string; readonly label: string; readonly conversations: readonly ChatConversation[] };

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Today, yesterday, the previous seven days and older, newest first, like other chat apps. */
export function groupChatConversations(conversations: readonly ChatConversation[], now: Date, copy: ChatCopy): ConversationGroup[] {
  const today = startOfLocalDay(now);
  const day = 24 * 60 * 60 * 1000;
  const groups: { key: string; label: string; conversations: ChatConversation[] }[] = [
    { key: "today", label: copy.groupToday, conversations: [] },
    { key: "yesterday", label: copy.groupYesterday, conversations: [] },
    { key: "week", label: copy.groupWeek, conversations: [] },
    { key: "older", label: copy.groupOlder, conversations: [] },
  ];
  for (const conversation of conversations) {
    const at = startOfLocalDay(new Date(conversation.updatedAt));
    const index = at >= today ? 0 : at >= today - day ? 1 : at >= today - 7 * day ? 2 : 3;
    groups[index].conversations.push(conversation);
  }
  return groups.filter((group) => group.conversations.length > 0);
}

type RunningTurn = { readonly requestId: string; readonly conversationId: string; readonly turnId: string };

export function ChatPage({ client: providedClient, now = () => new Date(), projectNames, cloudInvoke, watchCloudAccount = watchChatCloudAccount }: {
  readonly client?: ChatClient;
  readonly now?: () => Date;
  /** Active project names on this computer, used only to word a suggested task. */
  readonly projectNames?: readonly string[];
  /** Test seam for the chat-cloud Edge Function; the app uses the signed-in Supabase session. */
  readonly cloudInvoke?: CloudInvoke;
  /** Test seam for sign-in and sign-out while the page is open. */
  readonly watchCloudAccount?: ChatCloudAccountWatch;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const lang: ChatLanguage = chatLanguage(effectiveLanguage);
  const copy = CHAT_COPY[lang];
  const client = useMemo(() => providedClient ?? createChatClient(), [providedClient]);
  const [conversations, setConversations] = useState<ChatConversation[]>(() => readChatConversations());
  const [activeId, setActiveId] = useState<string | null>(() => readSessionChatId(readChatConversations()));
  const [connection, setConnection] = useState<ChatConnection>(readConnection);
  const [status, setStatus] = useState<ChatRuntimeStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState<RunningTurn | null>(null);
  const [taskIndex, setTaskIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const historyId = useId();
  const [cloudStatus, setCloudStatus] = useState<ChatCloudStatus | null>(null);
  const [storedCloudModel, setStoredCloudModel] = useState<ChatCloudModelKey | null>(readCloudModel);
  const [cliChoices, setCliChoices] = useState<ChatCliChoices>(readCliChoices);
  const [pendingAttachments, setPendingAttachments] = useState<readonly PendingAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cancelledCloudRef = useRef<string | null>(null);
  // Each turn's save for product improvement, so a rating is sent only after it.
  const savedTurnsRef = useRef(new Map<string, Promise<boolean>>());
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  // Where the centred composer sat when the first question left it, for its slide to the bottom.
  const composerStartTop = useRef<number | null>(null);
  const menuId = useId();
  const projectKey = (projectNames ?? []).join("\u0000");
  const tasks = useMemo(() => chatTasks(lang, { projectNames: projectKey ? projectKey.split("\u0000") : [] }), [lang, projectKey]);

  useEffect(() => {
    writeSessionChatId(activeId);
  }, [activeId]);

  // Past chats open from the header like a menu: focus lands on the open chat
  // (or the newest), and a click elsewhere or Escape closes the list.
  useEffect(() => {
    if (!historyOpen) return;
    const panel = historyPanelRef.current;
    (panel?.querySelector<HTMLButtonElement>('.chat-list__open[aria-current="true"]') ?? panel?.querySelector<HTMLButtonElement>(".chat-list__open"))?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (historyPanelRef.current?.contains(target) || historyButtonRef.current?.contains(target))) return;
      setHistoryOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setHistoryOpen(false);
      historyButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyOpen]);

  useEffect(() => {
    let cancelled = false;
    client.getStatus()
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => { if (!cancelled) setStatus({ providers: [], toolsAvailable: false, toolsMessage: null }); });
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => {
    writeChatConversations(conversations);
  }, [conversations]);

  // Re-read Cloud status when someone signs in or out while Chat is open.
  const [cloudAccountVersion, setCloudAccountVersion] = useState(0);
  useEffect(() => watchCloudAccount(() => setCloudAccountVersion((version) => version + 1)), [watchCloudAccount]);

  useEffect(() => {
    let cancelled = false;
    void readChatCloudStatus(cloudInvoke).then((next) => { if (!cancelled) setCloudStatus(next); });
    return () => { cancelled = true; };
  }, [cloudInvoke, cloudAccountVersion]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CHAT_CLI_CHOICE_STORAGE_KEY, JSON.stringify(cliChoices));
    } catch {
      // Remembering the choice is a convenience only.
    }
  }, [cliChoices]);

  useEffect(() => {
    if (!storedCloudModel) return;
    try {
      globalThis.localStorage?.setItem(CHAT_CLOUD_MODEL_STORAGE_KEY, storedCloudModel);
    } catch {
      // Remembering the model is a convenience only.
    }
  }, [storedCloudModel]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CHAT_CONNECTION_STORAGE_KEY, connection);
    } catch {
      // Remembering the connection is a convenience only.
    }
  }, [connection]);

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const turns = useMemo(() => active?.turns ?? [], [active]);

  useEffect(() => {
    const end = threadEndRef.current;
    if (end && typeof end.scrollIntoView === "function") end.scrollIntoView({ block: "end" });
  }, [turns]);

  const updateTurn = useCallback((conversationId: string, turnId: string, patch: (turn: ChatTurn) => ChatTurn) => {
    setConversations((list) => list.map((conversation) => (conversation.id !== conversationId ? conversation : {
      ...conversation,
      updatedAt: new Date().toISOString(),
      turns: conversation.turns.map((turn) => (turn.id === turnId ? patch(turn) : turn)),
    })));
  }, []);

  const availability = (provider: ChatProvider) => status?.providers.find((entry) => entry.provider === provider) ?? null;
  const selectedProvider: ChatProvider | null = connection === "cloud" ? null : connection;
  const providerReady = selectedProvider !== null && availability(selectedProvider)?.installed === true;
  const cloudModels = cloudStatus?.kind === "ready" ? cloudStatus.models : NO_CLOUD_MODELS;
  const cloudModel: ChatCloudModelKey = storedCloudModel && cloudModels.some((model) => model.key === storedCloudModel && model.allowed)
    ? storedCloudModel
    : cloudStatus?.kind === "ready" ? cloudStatus.defaultModel : "sonnet";
  const cloudModelLabel = cloudModels.find((model) => model.key === cloudModel)?.label ?? cloudModel;
  const cloudReady = cloudStatus?.kind === "ready" && cloudStatus.available;
  const connectionReady = connection === "cloud" ? cloudReady : providerReady;

  /** Ask a typed question, or run a suggested task (its title shows, its fuller prompt is sent). */
  const ask = useCallback(async (questionText: string, task?: Pick<ChatTask, "title" | "prompt"> & { readonly attachments?: readonly ChatAttachmentMeta[]; readonly requestWithoutDocuments?: string }) => {
    const question = (task ? task.title : questionText).trim();
    const typedRequest = (task ? task.prompt : questionText).trim();
    if (!question || !typedRequest || running) return;
    if (pendingAttachments.some((item) => item.status === "reading")) return;
    // A retry carries its documents in its saved request; anything else takes what is attached now.
    const composed = task?.attachments
      ? { prompt: typedRequest, attachments: [...task.attachments] }
      : composeChatRequest(typedRequest, pendingAttachments.flatMap((item) => (item.attachment ? [item.attachment] : [])));
    const request = composed.prompt;
    if (connection === "cloud" && !cloudReady) return;
    const startedAt = now().toISOString();
    const cliChoice: ChatCliSelection | null = connection === "cloud" ? null : cliChoices[connection];
    const cliChoiceLabel = connection === "cloud" || !cliChoice ? null : [
      CHAT_CLI_MODELS[connection].find((option) => option.id === cliChoice.model)?.label ?? cliChoice.model,
      CHAT_CLI_EFFORT_LABELS[cliChoice.effort],
    ].join(" · ");
    const turn: ChatTurn = {
      id: newId(), question, ...(request !== question ? { prompt: request } : {}),
      ...(composed.attachments.length > 0 ? {
        attachments: composed.attachments,
        requestWithoutDocuments: task?.attachments ? task.requestWithoutDocuments ?? question : typedRequest,
      } : {}), connection,
      ...(connection === "cloud" ? { model: cloudModelLabel } : cliChoiceLabel ? { model: cliChoiceLabel } : {}), status: "running",
      notes: [], answer: "", tools: [], error: null, startedAt, finishedAt: null,
    };
    const existing = conversations.find((conversation) => conversation.id === activeId) ?? null;
    const history = existing?.turns ?? [];
    if (history.length === 0) composerStartTop.current = composerRef.current?.getBoundingClientRect().top ?? null;
    const conversation: ChatConversation = existing
      ? { ...existing, updatedAt: startedAt, turns: [...existing.turns, turn] }
      : { id: newId(), title: chatConversationTitle(question), createdAt: startedAt, updatedAt: startedAt, turns: [turn] };
    setConversations((list) => upsertChatConversation(list, conversation));
    setActiveId(conversation.id);
    setDraft("");
    if (!task?.attachments) setPendingAttachments([]);
    const requestId = "turn-" + turn.id;
    setRunning({ requestId, conversationId: conversation.id, turnId: turn.id });

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
    const recentSuggestions = history.flatMap((previous) => previous.suggestions ?? []);
    const documents = composed.attachments.length > 0 || history.some((previous) => (previous.attachments?.length ?? 0) > 0);
    const productivityLabels = { focus: t("activity.productivity.focus"), neutral: t("activity.productivity.neutral"), drift: t("activity.productivity.drift") };
    const instructions = buildChatInstructions({ now: now(), timeZone, language: lang, productivityLabels, recentSuggestions, documents });
    const detail = readAiPrivacyRequestSettings().optional.windowTitle ? "titles" : "safe";
    // The latest state of this turn, kept here because state updaters run later
    // and the finished turn is what gets recorded.
    let latest: ChatTurn = turn;
    const progress = (patch: Partial<ChatTurn>) => {
      latest = { ...latest, ...patch };
      updateTurn(conversation.id, turn.id, (current) => ({ ...current, ...patch }));
    };
    const finish = (patch: (current: ChatTurn) => ChatTurn) => {
      latest = patch(latest);
      updateTurn(conversation.id, turn.id, patch);
    };
    try {
      if (connection === "cloud") {
        cancelledCloudRef.current = null;
        const result = await runChatCloudTurn({
          turnId: turn.id,
          model: cloudModel,
          instructions,
          history,
          request,
          detail,
          runTool: (call) => client.runTool(call),
          isCancelled: () => cancelledCloudRef.current === requestId,
          invoke: cloudInvoke,
          onProgress: (step) => progress({ notes: step.notes, tools: step.tools, charged: step.charged }),
        });
        const { answer, suggestions } = splitAnswerSuggestions(result.answer);
        const failed = !result.cancelled && !answer;
        if (result.credits) setCloudStatus((current) => (current?.kind === "ready" ? { ...current, credits: result.credits ?? current.credits } : current));
        finish((current) => ({
          ...current,
          notes: result.notes.map(visibleAnswerText).filter(Boolean),
          answer,
          ...(suggestions.length > 0 && !result.cancelled ? { suggestions } : {}),
          tools: result.tools.map((step) => (step.status === "running" ? { ...step, status: "failed" } : step)),
          charged: result.charged,
          status: result.cancelled ? "cancelled" : failed ? "error" : "done",
          error: failed ? copy.errorPrefix : null,
          finishedAt: now().toISOString(),
        }));
      } else {
        const provider: ChatProvider = connection;
        const prompt = buildChatPrompt(history, request);
        let stream = EMPTY_CHAT_STREAM;
        const exit = await client.send({ requestId, provider, detail, instructions, prompt, ...(cliChoice ?? {}) }, (line) => {
          stream = reduceChatStreamLine(stream, provider, line);
          const sofar = chatStreamAnswer(stream);
          // Until the turn ends, everything written so far reads as progress notes.
          progress({ notes: [...sofar.notes, sofar.answer].map(visibleAnswerText).filter(Boolean), answer: "", tools: stream.tools });
        });
        const { notes, answer: rawAnswer } = chatStreamAnswer(stream);
        const { answer, suggestions } = splitAnswerSuggestions(rawAnswer);
        const failed = !exit.cancelled && !answer;
        const fallback = lastMeaningfulLine(exit.stderrTail);
        finish((current) => ({
          ...current,
          notes: notes.map(visibleAnswerText).filter(Boolean),
          answer,
          ...(suggestions.length > 0 && !exit.cancelled ? { suggestions } : {}),
          tools: stream.tools.map((step) => (step.status === "running" ? { ...step, status: exit.cancelled ? "failed" : "done" } : step)),
          status: exit.cancelled ? "cancelled" : failed ? "error" : "done",
          error: failed ? stream.error ?? fallback : null,
          finishedAt: now().toISOString(),
        }));
      }
    } catch (error) {
      if (error instanceof ChatCloudError && error.credits) {
        const credits = error.credits;
        setCloudStatus((current) => (current?.kind === "ready" ? { ...current, credits } : current));
      }
      finish((current) => ({
        ...current,
        status: "error",
        error: error instanceof ChatCloudError ? cloudErrorMessage(error, copy, cloudModelLabel) : errorMessage(error) || null,
        finishedAt: now().toISOString(),
      }));
    } finally {
      setRunning(null);
      // Kept for product improvement only while the product analytics setting is on.
      if (latest.status !== "running" && readProductAnalyticsEnabled()) {
        savedTurnsRef.current.set(latest.id, recordChatTurn({ conversationId: conversation.id, turn: latest, language: lang, appVersion: BUILD_INFO.version || null }, cloudInvoke));
      }
    }
  }, [activeId, cliChoices, client, pendingAttachments, cloudInvoke, cloudModel, cloudModelLabel, cloudReady, connection, conversations, copy, lang, now, running, t, updateTurn]);

  const addFiles = (files: readonly ChatFileSource[]) => {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_CHAT_ATTACHMENTS - pendingAttachments.filter((item) => item.status !== "error").length);
    const added: PendingAttachment[] = files.map((file, index) => {
      const kind = chatAttachmentKind(isDroppedFile(file) ? { name: file.name, type: "" } : file);
      return index < room
        ? { id: newId(), name: file.name, kind, status: "reading" as const }
        : { id: newId(), name: file.name, kind, status: "error" as const, error: "tooMany" };
    });
    setPendingAttachments((list) => [...list, ...added]);
    added.forEach((item, index) => {
      if (item.status !== "reading") return;
      void readSource(files[index]).then(
        (attachment) => setPendingAttachments((list) => list.map((entry) => (entry.id === item.id ? { ...entry, status: "ready", attachment } : entry))),
        (error: unknown) => setPendingAttachments((list) => list.map((entry) => (entry.id === item.id
          ? { ...entry, status: "error", error: error instanceof ChatAttachmentReadError ? error.reason : "unreadable" }
          : entry))),
      );
    });
    inputRef.current?.focus();
  };
  const removeAttachment = (id: string) => setPendingAttachments((list) => list.filter((item) => item.id !== id));

  // In the app, files dropped anywhere on the window while Chat is open attach
  // to the question; the browser preview uses the composer's own drop events.
  const pageDrops = !client.watchFileDrops;
  const latestDrop = useRef<{ readonly add: (files: readonly ChatFileSource[]) => void; readonly busy: boolean }>({ add: () => undefined, busy: false });
  useLayoutEffect(() => {
    latestDrop.current = { add: addFiles, busy: Boolean(running) };
  });
  useEffect(() => {
    if (!client.watchFileDrops) return undefined;
    return client.watchFileDrops({
      onDragging: (dragging) => setDraggingFiles(dragging && !latestDrop.current.busy),
      onDrop: (files) => {
        if (!latestDrop.current.busy) latestDrop.current.add(files);
      },
    });
  }, [client]);

  const retry = (turn: ChatTurn) => {
    void ask(turn.question, turn.prompt ? {
      title: turn.question, prompt: turn.prompt,
      ...(turn.attachments ? { attachments: turn.attachments, requestWithoutDocuments: turn.requestWithoutDocuments ?? turn.question } : {}),
    } : undefined);
  };

  // The rating stays with the chat on this computer; with product analytics on it
  // also goes to the saved turn, after that turn's own save has finished.
  const rate = (turn: ChatTurn, rating: ChatFeedback | null) => {
    if (!active) return;
    updateTurn(active.id, turn.id, (current) => ({ ...current, feedback: rating ?? undefined }));
    if (!readProductAnalyticsEnabled()) return;
    const saved = savedTurnsRef.current.get(turn.id) ?? Promise.resolve(true);
    void saved.then(() => sendChatTurnFeedback(turn.id, rating, cloudInvoke));
  };

  const slashQuery = draft.startsWith("/") ? draft.slice(1) : null;
  // Typing "/" opens the suggested tasks; the composer's placeholder says so.
  const menuVisible = !running && slashQuery !== null;
  const menuTasks = useMemo(() => filterChatTasks(tasks, slashQuery ?? ""), [tasks, slashQuery]);
  const highlighted = Math.min(taskIndex, Math.max(0, menuTasks.length - 1));

  const runTask = (task: ChatTask) => {
    setTaskIndex(0);
    if (!connectionReady) return;
    void ask(task.title, task);
  };

  const closeMenu = () => {
    setTaskIndex(0);
    if (slashQuery !== null) setDraft("");
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (menuVisible && slashQuery !== null) {
      const task = menuTasks[highlighted];
      if (task) runTask(task);
      return;
    }
    void ask(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (menuVisible) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setTaskIndex((highlighted + step + menuTasks.length) % Math.max(1, menuTasks.length));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && menuTasks[highlighted]) {
        event.preventDefault();
        runTask(menuTasks[highlighted]);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const startNewChat = () => {
    if (running) return;
    setActiveId(null);
    setHistoryOpen(false);
    setDraft("");
    inputRef.current?.focus();
  };

  const openConversation = (id: string) => {
    if (running) return;
    setActiveId(id);
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const deleteConversation = (id: string) => {
    if (running?.conversationId === id) return;
    setConversations((list) => removeChatConversation(list, id));
    if (activeId === id) setActiveId(null);
  };

  const usageLine = (() => {
    if (connection === "cloud") {
      if (!cloudStatus) return copy.cloudChecking;
      if (cloudStatus.kind === "sign_in_required" || cloudStatus.kind === "full_account_required") return copy.cloudSignIn;
      if (cloudStatus.kind !== "ready") return copy.cloudUnavailable;
      if (!cloudStatus.available) return copy.cloudPlanRequired;
      return copy.cloudCredits(cloudStatus.credits.remaining, cloudStatus.credits.renewsAt);
    }
    if (status && !status.toolsAvailable && status.providers.length > 0 && client.kind === "native") return copy.toolsMissing;
    const ready = availability(connection);
    if (status && !ready?.installed) return connection === "codex" ? copy.missingCodex : copy.missingClaude;
    return connection === "codex" ? copy.usageCodex : copy.usageClaude;
  })();

  const connectionOptions: SettingsSelectOption<ChatConnection>[] = (["codex", "claude", "cloud"] as const).map((value) => {
    const missing = value !== "cloud" && status !== null && !availability(value)?.installed;
    return {
      value,
      label: value === "codex" ? copy.codex : value === "claude" ? copy.claude : copy.cloud,
      description: copy.connectionDescription(value),
      icon: <ConnectionIcon connection={value} />,
      statusLabel: missing ? copy.notInstalled : undefined,
      statusTone: missing ? "warning" : undefined,
      muted: missing,
    };
  });
  const cliProvider: ChatProvider | null = connection === "cloud" ? null : connection;
  const cliChoice: ChatCliSelection | null = cliProvider ? cliChoices[cliProvider] : null;
  const cliModelOptions: SettingsSelectOption<string>[] = cliProvider
    ? CHAT_CLI_MODELS[cliProvider].map((option) => ({ value: option.id, label: option.label, description: copy.cliModelHint(option.hint) }))
    : [];
  const effortOptions: SettingsSelectOption<string>[] = CHAT_CLI_EFFORTS.map((level) => ({
    value: level,
    label: CHAT_CLI_EFFORT_LABELS[level],
    icon: <EffortIcon />,
  }));
  const chooseCli = (patch: { readonly model?: string; readonly effort?: string }) => {
    if (!cliProvider) return;
    setCliChoices((current) => {
      const next = { ...current[cliProvider] };
      if (patch.model !== undefined && CHAT_CLI_MODELS[cliProvider].some((option) => option.id === patch.model)) next.model = patch.model;
      if (patch.effort !== undefined && isChatCliEffort(patch.effort)) next.effort = patch.effort;
      return { ...current, [cliProvider]: next };
    });
  };
  const cloudModelOptions: SettingsSelectOption<ChatCloudModelKey>[] = cloudModels.map((model) => ({
    value: model.key,
    label: model.label,
    description: copy.modelDescription(model.key),
    statusLabel: model.allowed ? undefined : copy.proOnly,
    disabled: !model.allowed,
  }));

  const canSend = Boolean(draft.trim()) && !running && connectionReady && slashQuery === null
    && !pendingAttachments.some((item) => item.status === "reading");
  const stop = () => {
    if (!running) return;
    if (connection === "cloud") cancelledCloudRef.current = running.requestId;
    else void client.cancel(running.requestId);
  };
  const isEmpty = turns.length === 0;
  // The input grows with what is typed, up to its CSS max-height, like other chat apps.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    if (input.scrollHeight > 0) input.style.height = input.scrollHeight + "px";
  }, [draft]);
  // The first question moves the composer from the centre to the bottom, as in ChatGPT and Claude;
  // it slides there instead of jumping, unless the person prefers reduced motion.
  useLayoutEffect(() => {
    const form = composerRef.current;
    const startTop = composerStartTop.current;
    composerStartTop.current = null;
    if (isEmpty || !form || startTop === null || typeof form.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const offset = startTop - form.getBoundingClientRect().top;
    if (Math.abs(offset) < 4) return;
    form.animate(
      [{ transform: "translateY(" + offset + "px)" }, { transform: "translateY(0)" }],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [isEmpty]);
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const followUps = !running && lastTurn?.status === "done" ? lastTurn.suggestions ?? [] : [];
  const groups = groupChatConversations(conversations, now(), copy);
  const locale = chatLocale(lang);
  // Today's and yesterday's chats show their time, older ones their date.
  const listWhen = (groupKey: string, iso: string) => groupKey === "today" || groupKey === "yesterday"
    ? new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    : new Date(iso).toLocaleDateString(locale, { month: "short", day: "numeric" });

  return (
    <div className="page chat-page">
      <div className="pg-head chat-head">
        <h1 className="chat-sr-only">{copy.title}</h1>
        {client.kind === "preview" ? <span className="chat-preview-note">{copy.previewData}</span> : null}
        {turns.length > 0 ? (
          <button type="button" className="chat-head-button" aria-label={copy.newChat} onClick={startNewChat} disabled={Boolean(running)}>
            <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.25 8.75v3.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5v-8a1.5 1.5 0 0 1 1.5-1.5h3.5" /><path d="M11.6 2.4a1.2 1.2 0 0 1 1.7 1.7L8.5 8.9 6.25 9.75l.85-2.25Z" /></svg>
            <ChatTip side="bottom">{copy.newChat}</ChatTip>
          </button>
        ) : null}
        <div className="chat-history">
          <button
            ref={historyButtonRef}
            type="button"
            className="chat-head-button chat-history__trigger"
            aria-label={copy.history}
            aria-expanded={historyOpen}
            aria-controls={historyOpen ? historyId : undefined}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.75 8a5.25 5.25 0 1 0 1.54-3.71" /><path d="M2.5 2.75v2.5H5" /><path d="M8 5.25V8l1.9 1.25" /></svg>
            {historyOpen ? null : <ChatTip side="bottom">{copy.history}</ChatTip>}
          </button>
          <AnchoredPresence>{historyOpen ? (
            <div ref={historyPanelRef} id={historyId} className="chat-history__panel" role="dialog" aria-label={copy.history}>
              <div className="chat-history__list">
                {conversations.length === 0 ? <p className="chat-list__empty">{copy.noConversations}</p> : null}
                {groups.map((group) => (
                  <div key={group.key} className="chat-list__group">
                    <p className="chat-list__group-label">{group.label}</p>
                    <ul>
                      {group.conversations.map((conversation) => (
                        <li key={conversation.id} className={"chat-list__item" + (conversation.id === activeId ? " is-active" : "")}>
                          <button type="button" className="chat-list__open" onClick={() => openConversation(conversation.id)} disabled={Boolean(running)} aria-current={conversation.id === activeId ? "true" : undefined}>
                            <span className="chat-list__title">{conversation.title}</span>
                            <span className="chat-list__date">{listWhen(group.key, conversation.updatedAt)}</span>
                          </button>
                          <button type="button" className="chat-list__delete" aria-label={copy.deleteConversation} onClick={() => deleteConversation(conversation.id)} disabled={running?.conversationId === conversation.id}>
                            <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="chat-list__foot">{copy.storedLocally}</p>
            </div>
          ) : null}</AnchoredPresence>
        </div>
      </div>
      <div className="chat-shell">
        <section className={"chat-main" + (isEmpty ? " chat-main--empty" : "")} aria-label={active?.title ?? copy.newChat}>
          {isEmpty ? (
            <div className="chat-empty">
              <h2 className="chat-empty__title">{copy.emptyTitle}</h2>
            </div>
          ) : (
            <div className="chat-thread" aria-live="polite">
              {turns.map((turn, index) => (
                <ChatTurnView
                  key={turn.id}
                  turn={turn}
                  lang={lang}
                  copy={copy}
                  onRetry={retry}
                  onRate={rate}
                  canRetry={!running && connectionReady}
                  isLast={index === turns.length - 1}
                />
              ))}
              {followUps.length > 0 ? (
                <div className="chat-followups">
                  <p className="chat-followups__label">{copy.followUps}</p>
                  <div className="chat-followups__list">
                    {followUps.map((suggestion) => (
                      <button key={suggestion} type="button" className="chat-suggestion" disabled={!connectionReady} onClick={() => void ask(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>
          )}
          <form ref={composerRef} className="chat-composer" onSubmit={submit}>
            {menuVisible ? (
              <div className="chat-task-menu" role="listbox" id={menuId} aria-label={copy.tasks}>
                {menuTasks.length === 0 ? <p className="chat-task-menu__empty">{copy.noTasks}</p> : menuTasks.map((task, index) => (
                  <button
                    key={task.id}
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    className={"chat-task-menu__item" + (index === highlighted ? " is-highlighted" : "")}
                    disabled={!connectionReady}
                    onMouseEnter={() => setTaskIndex(index)}
                    onClick={() => runTask(task)}
                  >
                    <TaskIcon icon={task.icon} />
                    <span className="chat-task-menu__title">{task.title}</span>
                    <span className="chat-task-menu__description">{task.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div
              className={"chat-composer__box" + (draggingFiles ? " is-dragging" : "")}
              data-drop-label={copy.attachDrop}
              onDragOver={(event) => {
                if (!pageDrops || !hasFiles(event.dataTransfer) || running) return;
                event.preventDefault();
                setDraggingFiles(true);
              }}
              onDragLeave={(event) => {
                if (!pageDrops || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDraggingFiles(false);
              }}
              onDrop={(event) => {
                if (!pageDrops || !hasFiles(event.dataTransfer)) return;
                event.preventDefault();
                setDraggingFiles(false);
                if (!running) addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              {pendingAttachments.length > 0 ? (
                <ul className="chat-attachments" aria-label={copy.attachments}>
                  {pendingAttachments.map((item) => (
                    <li key={item.id} className={"chat-attachment" + (item.status === "error" ? " is-error" : "")}>
                      <span className="chat-attachment__icon" aria-hidden="true">
                        {item.status === "reading" ? <span className="chat-step__spinner" /> : <FileIcon />}
                      </span>
                      <span className="chat-attachment__text">
                        <span className="chat-attachment__name">{item.name}</span>
                        <span className="chat-attachment__meta">
                          {item.status === "reading" ? copy.attachReading
                            : item.status === "error" ? copy.attachError(item.error ?? "unreadable")
                              : copy.attachKind(item.kind ?? "text") + (item.attachment?.truncated ? " · " + copy.attachTruncated : "")}
                        </span>
                      </span>
                      <button type="button" className="chat-attachment__remove" aria-label={copy.attachRemove(item.name)} onClick={() => removeAttachment(item.id)}>
                        <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <label className="chat-sr-only" htmlFor="chat-input">{copy.placeholder}</label>
              <textarea
                id="chat-input"
                ref={inputRef}
                rows={1}
                value={draft}
                placeholder={copy.placeholderHint}
                aria-controls={menuVisible ? menuId : undefined}
                aria-expanded={menuVisible}
                onChange={(event) => { setDraft(event.target.value); setTaskIndex(0); }}
                onKeyDown={onKeyDown}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (files.length === 0) return;
                  event.preventDefault();
                  addFiles(files);
                }}
              />
              <div className="chat-composer__row">
                <button
                  type="button"
                  className="chat-attach-button"
                  aria-label={copy.attach}
                  disabled={Boolean(running)}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon />
                  <ChatTip side="top">{copy.attach}</ChatTip>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  className="chat-sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="chat-file-input"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <SettingsSelect<ChatConnection>
                  ariaLabel={copy.connection}
                  className="chat-picker"
                  placement="below"
                  value={connection}
                  options={connectionOptions}
                  disabled={Boolean(running)}
                  onChange={setConnection}
                />
                {connection === "cloud" && cloudModels.length > 0 ? (
                  <SettingsSelect<ChatCloudModelKey>
                    ariaLabel={copy.cloudModel}
                    className="chat-picker"
                    placement="below"
                    value={cloudModel}
                    options={cloudModelOptions}
                    disabled={Boolean(running)}
                    onChange={setStoredCloudModel}
                  />
                ) : null}
                {cliProvider && cliChoice ? (
                  <>
                    <SettingsSelect<string>
                      ariaLabel={copy.cliModel}
                      className="chat-picker"
                      placement="below"
                      value={cliChoice.model}
                      options={cliModelOptions}
                      disabled={Boolean(running)}
                      onChange={(model) => chooseCli({ model })}
                    />
                    <SettingsSelect<string>
                      ariaLabel={copy.effort}
                      className="chat-picker chat-picker--effort"
                      placement="below"
                      value={cliChoice.effort}
                      options={effortOptions}
                      disabled={Boolean(running)}
                      onChange={(effort) => chooseCli({ effort })}
                    />
                  </>
                ) : null}
                <span className="chat-composer__spacer" />
                {running ? (
                  <button type="button" className="chat-send chat-send--stop" aria-label={copy.stop} onClick={stop}>
                    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
                  </button>
                ) : (
                  <button type="submit" className="chat-send" aria-label={copy.send} disabled={!canSend}>
                    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
                  </button>
                )}
              </div>
            </div>
            <p className="chat-usage">{usageLine}</p>
          </form>
          {isEmpty ? (
            <ul className="chat-tasks" aria-label={copy.tasks}>
              {tasks.slice(0, EMPTY_STATE_TASKS).map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className="chat-task"
                    aria-label={task.title}
                    aria-describedby={menuId + "-" + task.id}
                    disabled={!connectionReady || Boolean(running)}
                    onClick={() => runTask(task)}
                  >
                    <TaskIcon icon={task.icon} />
                    <span className="chat-task__title">{task.title}</span>
                    <span className="chat-sr-only" id={menuId + "-" + task.id}>{task.description}</span>
                    <ChatTip side="bottom">{task.description}</ChatTip>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}

