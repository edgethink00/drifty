import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { BUILD_INFO } from "../../buildInfo";
import { readProductAnalyticsEnabled } from "../../lib/analytics/productAnalyticsPreference";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { createChatClient, type ChatClient } from "./chatClient";
import {
  ChatCloudError,
  readChatCloudStatus,
  recordChatTurn,
  runChatCloudTurn,
  type ChatCloudModelKey,
  type ChatCloudModelOption,
  type ChatCloudStatus,
} from "./chatCloudClient";
import { CHAT_COPY, type ChatCopy, type ChatLanguage } from "./chatCopy";
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
import type { ChatConnection, ChatConversation, ChatProvider, ChatRuntimeStatus, ChatToolStep, ChatTurn } from "./chatTypes";
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

function readCloudModel(): ChatCloudModelKey | null {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_CLOUD_MODEL_STORAGE_KEY);
    return stored === "sonnet" || stored === "haiku" || stored === "opus" || stored === "fable" ? stored : null;
  } catch {
    return null;
  }
}

const NO_CLOUD_MODELS: readonly ChatCloudModelOption[] = [];

/** The strongest other model the credits left still cover, so a low balance points somewhere useful. */
function affordableCloudModel(models: readonly ChatCloudModelOption[], modelLabel: string, remaining: number): ChatCloudModelOption | null {
  return [...models]
    .filter((model) => model.allowed && model.label !== modelLabel && model.minimumCredits <= remaining)
    .sort((a, b) => b.minimumCredits - a.minimumCredits)[0] ?? null;
}

function cloudErrorMessage(error: ChatCloudError, copy: ChatCopy, modelLabel: string, models: readonly ChatCloudModelOption[]): string {
  switch (error.code) {
    case "credits_exhausted": return copy.cloudErrorExhausted(error.credits?.renewsAt ?? null);
    case "credits_low_for_model": {
      const fallback = affordableCloudModel(models, modelLabel, error.credits?.remaining ?? 0);
      return fallback ? copy.cloudErrorLowForModel(modelLabel, fallback.label) : copy.cloudErrorExhausted(error.credits?.renewsAt ?? null);
    }
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

function dayLabel(value: unknown, lang: ChatLanguage): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (lang === "ko") return month + "월 " + day + "일";
  return new Date(Number(match[1]), month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function chatToolLabel(step: ChatToolStep, lang: ChatLanguage, copy: ChatCopy): string {
  const day = dayLabel(step.args.day, lang);
  const from = dayLabel(step.args.from, lang);
  const to = dayLabel(step.args.to, lang);
  const range = day ?? (from && to ? (from === to ? from : from + "–" + to) : copy.allTime);
  if (step.name === "summary") return lang === "ko" ? (day ?? range) + " 기록 요약" : "Summary of " + (day ?? range);
  if (step.name === "timeline") return lang === "ko" ? (day ?? range) + " 타임라인" : "Timeline of " + (day ?? range);
  if (step.name === "search") {
    const query = typeof step.args.query === "string" ? step.args.query.trim() : "";
    if (!query) return lang === "ko" ? "기록 검색 · " + range : "Searched records · " + range;
    return lang === "ko" ? "‘" + query + "’ 검색 · " + range : "Searched “" + query + "” · " + range;
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
        <ul id={listId} className="chat-steps" aria-label={lang === "ko" ? "확인한 기록" : "Records checked"}>
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

function ChatTurnView({ turn, lang, copy, onRetry, canRetry, isLast }: {
  readonly turn: ChatTurn;
  readonly lang: ChatLanguage;
  readonly copy: ChatCopy;
  readonly onRetry: (turn: ChatTurn) => void;
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
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(turn.answer).then(() => setCopied(true), () => undefined);
  };
  return (
    <article className="chat-turn">
      <div className="chat-turn__question">{turn.question}</div>
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
          <div className="chat-answer__actions">
            <button type="button" className="chat-action" onClick={copyAnswer}>
              <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.25a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.25" /></svg>
              <span aria-live="polite">{copied ? copy.copied : copy.copyAnswer}</span>
            </button>
            {isLast && canRetry ? (
              <button type="button" className="chat-action" onClick={() => onRetry(turn)}>
                <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.67" /><path d="M13 2.75v3h-3" /></svg>
                <span>{copy.retry}</span>
              </button>
            ) : null}
            {turn.connection === "cloud" && turn.charged !== undefined ? (
              <span className="chat-answer__meta">{(turn.model ? turn.model + " · " : "") + copy.creditsUsed(turn.charged)}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ChatNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { effectiveLanguage } = useLocalization();
  const label = CHAT_COPY[effectiveLanguage === "ko" ? "ko" : "en"].nav;
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
      <span>{label}</span>
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

export function ChatPage({ client: providedClient, now = () => new Date(), projectNames, cloudInvoke }: {
  readonly client?: ChatClient;
  readonly now?: () => Date;
  /** Active project names on this computer, used only to word a suggested task. */
  readonly projectNames?: readonly string[];
  /** Test seam for the chat-cloud Edge Function; the app uses the signed-in Supabase session. */
  readonly cloudInvoke?: CloudInvoke;
}) {
  const { effectiveLanguage } = useLocalization();
  const lang: ChatLanguage = effectiveLanguage === "ko" ? "ko" : "en";
  const copy = CHAT_COPY[lang];
  const client = useMemo(() => providedClient ?? createChatClient(), [providedClient]);
  const [conversations, setConversations] = useState<ChatConversation[]>(() => readChatConversations());
  const [activeId, setActiveId] = useState<string | null>(() => readChatConversations()[0]?.id ?? null);
  const [connection, setConnection] = useState<ChatConnection>(readConnection);
  const [status, setStatus] = useState<ChatRuntimeStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState<RunningTurn | null>(null);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [taskIndex, setTaskIndex] = useState(0);
  const [cloudStatus, setCloudStatus] = useState<ChatCloudStatus | null>(null);
  const [storedCloudModel, setStoredCloudModel] = useState<ChatCloudModelKey | null>(readCloudModel);
  const cancelledCloudRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuId = useId();
  const projectKey = (projectNames ?? []).join("\u0000");
  const tasks = useMemo(() => chatTasks(lang, { projectNames: projectKey ? projectKey.split("\u0000") : [] }), [lang, projectKey]);

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

  useEffect(() => {
    let cancelled = false;
    void readChatCloudStatus(cloudInvoke).then((next) => { if (!cancelled) setCloudStatus(next); });
    return () => { cancelled = true; };
  }, [cloudInvoke]);

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
  const ask = useCallback(async (questionText: string, task?: Pick<ChatTask, "title" | "prompt">) => {
    const question = (task ? task.title : questionText).trim();
    const request = (task ? task.prompt : questionText).trim();
    if (!question || !request || running) return;
    if (connection === "cloud" && !cloudReady) return;
    const startedAt = now().toISOString();
    const turn: ChatTurn = {
      id: newId(), question, ...(request !== question ? { prompt: request } : {}), connection,
      ...(connection === "cloud" ? { model: cloudModelLabel } : {}), status: "running",
      notes: [], answer: "", tools: [], error: null, startedAt, finishedAt: null,
    };
    const existing = conversations.find((conversation) => conversation.id === activeId) ?? null;
    const history = existing?.turns ?? [];
    const conversation: ChatConversation = existing
      ? { ...existing, updatedAt: startedAt, turns: [...existing.turns, turn] }
      : { id: newId(), title: chatConversationTitle(question), createdAt: startedAt, updatedAt: startedAt, turns: [turn] };
    setConversations((list) => upsertChatConversation(list, conversation));
    setActiveId(conversation.id);
    setDraft("");
    setTaskMenuOpen(false);
    const requestId = "turn-" + turn.id;
    setRunning({ requestId, conversationId: conversation.id, turnId: turn.id });

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
    const recentSuggestions = history.flatMap((previous) => previous.suggestions ?? []);
    const instructions = buildChatInstructions({ now: now(), timeZone, language: lang, recentSuggestions });
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
        const exit = await client.send({ requestId, provider, detail, instructions, prompt }, (line) => {
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
        error: error instanceof ChatCloudError ? cloudErrorMessage(error, copy, cloudModelLabel, cloudModels) : errorMessage(error) || null,
        finishedAt: now().toISOString(),
      }));
    } finally {
      setRunning(null);
      // Kept for product improvement only while the product analytics setting is on.
      if (latest.status !== "running" && readProductAnalyticsEnabled()) {
        void recordChatTurn({ conversationId: conversation.id, turn: latest, language: lang, appVersion: BUILD_INFO.version || null }, cloudInvoke);
      }
    }
  }, [activeId, client, cloudInvoke, cloudModel, cloudModelLabel, cloudModels, cloudReady, connection, conversations, copy, lang, now, running, updateTurn]);

  const retry = (turn: ChatTurn) => {
    void ask(turn.question, turn.prompt ? { title: turn.question, prompt: turn.prompt } : undefined);
  };

  const slashQuery = draft.startsWith("/") ? draft.slice(1) : null;
  const menuVisible = !running && (taskMenuOpen || slashQuery !== null);
  const menuTasks = useMemo(() => filterChatTasks(tasks, slashQuery ?? ""), [tasks, slashQuery]);
  const highlighted = Math.min(taskIndex, Math.max(0, menuTasks.length - 1));

  const runTask = (task: ChatTask) => {
    setTaskMenuOpen(false);
    setTaskIndex(0);
    if (!connectionReady) return;
    void ask(task.title, task);
  };

  const closeMenu = () => {
    setTaskMenuOpen(false);
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
      if (event.key === "Enter" && !event.shiftKey && (slashQuery !== null || taskMenuOpen) && menuTasks[highlighted] && (slashQuery !== null || !draft.trim())) {
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
    setDraft("");
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

  const providerLabel = (provider: ChatProvider) => {
    const base = provider === "codex" ? copy.codex : copy.claude;
    return status && !availability(provider)?.installed ? base + " " + copy.notInstalled : base;
  };

  const canSend = Boolean(draft.trim()) && !running && connectionReady && slashQuery === null;
  const stop = () => {
    if (!running) return;
    if (connection === "cloud") cancelledCloudRef.current = running.requestId;
    else void client.cancel(running.requestId);
  };
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const followUps = !running && lastTurn?.status === "done" ? lastTurn.suggestions ?? [] : [];
  const groups = groupChatConversations(conversations, now(), copy);
  const listDate = (iso: string) => new Date(iso).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" });

  return (
    <div className="page chat-page">
      <div className="pg-head chat-head">
        <h1>{copy.title}<span className="chat-beta">{copy.beta}</span></h1>
        {client.kind === "preview" ? <span className="chat-preview-note">{copy.previewData}</span> : null}
        <button type="button" className="app-btn app-btn--secondary app-btn--header-action" onClick={startNewChat} disabled={Boolean(running)}>
          {copy.newChat}
        </button>
      </div>
      <div className="chat-shell">
        <aside className="chat-list" aria-label={copy.conversations}>
          <p className="chat-list__heading">{copy.conversations}</p>
          {conversations.length === 0 ? <p className="chat-list__empty">{copy.noConversations}</p> : null}
          {groups.map((group) => (
            <div key={group.key} className="chat-list__group">
              <p className="chat-list__group-label">{group.label}</p>
              <ul>
                {group.conversations.map((conversation) => (
                  <li key={conversation.id} className={"chat-list__item" + (conversation.id === activeId ? " is-active" : "")}>
                    <button type="button" className="chat-list__open" onClick={() => !running && setActiveId(conversation.id)} aria-current={conversation.id === activeId ? "true" : undefined}>
                      <span className="chat-list__title">{conversation.title}</span>
                      {group.key === "older" || group.key === "week" ? <span className="chat-list__date">{listDate(conversation.updatedAt)}</span> : null}
                    </button>
                    <button type="button" className="chat-list__delete" aria-label={copy.deleteConversation} onClick={() => deleteConversation(conversation.id)} disabled={running?.conversationId === conversation.id}>
                      <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="chat-list__foot">{copy.storedLocally}</p>
        </aside>
        <section className="chat-main" aria-label={active?.title ?? copy.newChat}>
          <div className="chat-thread" aria-live="polite">
            {turns.length === 0 ? (
              <div className="chat-empty">
                <p className="chat-empty__title">{copy.emptyTitle}</p>
                <p className="chat-empty__body">{copy.emptyBody}</p>
                <p className="chat-tasks__label">{copy.tasks}</p>
                <ul className="chat-tasks">
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
                        <span className="chat-task__text">
                          <span className="chat-task__title">{task.title}</span>
                          <span className="chat-task__description" id={menuId + "-" + task.id}>{task.description}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="chat-empty__privacy">{copy.privacy}</p>
              </div>
            ) : turns.map((turn, index) => (
              <ChatTurnView
                key={turn.id}
                turn={turn}
                lang={lang}
                copy={copy}
                onRetry={retry}
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
          <form className="chat-composer" onSubmit={submit}>
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
            <label className="chat-sr-only" htmlFor="chat-input">{copy.placeholder}</label>
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder={copy.placeholderHint}
              aria-controls={menuVisible ? menuId : undefined}
              aria-expanded={menuVisible}
              onChange={(event) => { setDraft(event.target.value); setTaskIndex(0); }}
              onKeyDown={onKeyDown}
            />
            <div className="chat-composer__row">
              <button
                type="button"
                className={"chat-tasks-button" + (menuVisible ? " is-open" : "")}
                aria-label={copy.tasks}
                aria-expanded={menuVisible}
                aria-controls={menuVisible ? menuId : undefined}
                disabled={Boolean(running)}
                onClick={() => { if (menuVisible) closeMenu(); else { setTaskMenuOpen(true); inputRef.current?.focus(); } }}
              >
                <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3Z" /><path d="M12.5 11v3M11 12.5h3" /></svg>
              </button>
              <label className="chat-sr-only" htmlFor="chat-connection">{copy.connection}</label>
              <select id="chat-connection" className="chat-connection" value={connection} disabled={Boolean(running)} onChange={(event) => setConnection(event.target.value as ChatConnection)}>
                <option value="codex">{providerLabel("codex")}</option>
                <option value="claude">{providerLabel("claude")}</option>
                <option value="cloud">{copy.cloud}</option>
              </select>
              {connection === "cloud" && cloudModels.length > 0 ? (
                <>
                  <label className="chat-sr-only" htmlFor="chat-cloud-model">{copy.cloudModel}</label>
                  <select id="chat-cloud-model" className="chat-connection" value={cloudModel} disabled={Boolean(running)} onChange={(event) => setStoredCloudModel(event.target.value as ChatCloudModelKey)}>
                    {cloudModels.map((model) => (
                      <option key={model.key} value={model.key} disabled={!model.allowed}>
                        {model.label + copy.modelHint(model.key) + (model.allowed ? "" : " " + copy.proOnly)}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <p className="chat-usage">{usageLine}</p>
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
          </form>
        </section>
      </div>
    </div>
  );
}

