import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { createChatClient, type ChatClient } from "./chatClient";
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
import type { ChatConnection, ChatConversation, ChatProvider, ChatRuntimeStatus, ChatToolStep, ChatTurn } from "./chatTypes";
import "./chat.css";

export const CHAT_CONNECTION_STORAGE_KEY = "drifty.chat.connection";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function readConnection(): ChatConnection {
  try {
    const stored = globalThis.localStorage?.getItem(CHAT_CONNECTION_STORAGE_KEY);
    return stored === "claude" || stored === "cloud" ? stored : "codex";
  } catch {
    return "codex";
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

/** A small, safe subset of Markdown: paragraphs, bullet lists, bold and inline code. */
export function ChatAnswerText({ text }: { readonly text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="chat-answer__text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        if (lines.length > 0 && lines.every((line) => LIST_ITEM.test(line))) {
          return <ul key={index}>{lines.map((line, item) => <li key={item}>{renderInline(line.replace(LIST_ITEM, ""))}</li>)}</ul>;
        }
        return (
          <p key={index}>
            {lines.map((line, item) => (
              <span key={item}>{item > 0 ? <br /> : null}{renderInline(line)}</span>
            ))}
          </p>
        );
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

function ChatTurnView({ turn, lang, copy, onRetry, canRetry }: {
  readonly turn: ChatTurn;
  readonly lang: ChatLanguage;
  readonly copy: ChatCopy;
  readonly onRetry: (question: string) => void;
  readonly canRetry: boolean;
}) {
  const running = turn.status === "running";
  return (
    <article className="chat-turn">
      <div className="chat-turn__question">{turn.question}</div>
      <div className="chat-answer" aria-busy={running}>
        {turn.tools.length > 0 ? (
          <ul className="chat-steps" aria-label={lang === "ko" ? "확인한 기록" : "Records checked"}>
            {turn.tools.map((step) => (
              <li key={step.id} className={"chat-step chat-step--" + step.status}>
                <ToolIcon status={step.status} />
                <span>{chatToolLabel(step, lang, copy)}</span>
                {step.status === "running" ? <span className="chat-step__state">{copy.toolRunning}</span> : null}
                {step.status === "failed" ? <span className="chat-step__state">{copy.toolFailed}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {turn.notes.map((note, index) => <p key={index} className="chat-answer__note">{note}</p>)}
        {turn.answer ? <ChatAnswerText text={turn.answer} /> : null}
        {running && !turn.answer ? (
          <p className="chat-answer__pending"><span className="chat-step__spinner" aria-hidden="true" />{turn.tools.length > 0 ? copy.thinking : copy.checking}</p>
        ) : null}
        {turn.status === "cancelled" ? <p className="chat-answer__note">{copy.stopped}</p> : null}
        {turn.status === "error" ? (
          <div className="chat-answer__error" role="alert">
            <p>{copy.errorPrefix}{turn.error ? " " + turn.error : ""}</p>
            {canRetry ? <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={() => onRetry(turn.question)}>{copy.retry}</button> : null}
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

type RunningTurn = { readonly requestId: string; readonly conversationId: string; readonly turnId: string };

export function ChatPage({ client: providedClient, now = () => new Date() }: { readonly client?: ChatClient; readonly now?: () => Date }) {
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
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  const ask = useCallback(async (questionText: string) => {
    const question = questionText.trim();
    if (!question || running || connection === "cloud") return;
    const provider: ChatProvider = connection;
    const startedAt = now().toISOString();
    const turn: ChatTurn = {
      id: newId(), question, connection, status: "running", notes: [], answer: "", tools: [], error: null, startedAt, finishedAt: null,
    };
    const existing = conversations.find((conversation) => conversation.id === activeId) ?? null;
    const history = existing?.turns ?? [];
    const conversation: ChatConversation = existing
      ? { ...existing, updatedAt: startedAt, turns: [...existing.turns, turn] }
      : { id: newId(), title: chatConversationTitle(question), createdAt: startedAt, updatedAt: startedAt, turns: [turn] };
    setConversations((list) => upsertChatConversation(list, conversation));
    setActiveId(conversation.id);
    setDraft("");
    const requestId = "turn-" + turn.id;
    setRunning({ requestId, conversationId: conversation.id, turnId: turn.id });

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
    const instructions = buildChatInstructions({ now: now(), timeZone, language: lang });
    const prompt = buildChatPrompt(history, question);
    const detail = readAiPrivacyRequestSettings().optional.windowTitle ? "titles" : "safe";
    let stream = EMPTY_CHAT_STREAM;
    try {
      const exit = await client.send({ requestId, provider, detail, instructions, prompt }, (line) => {
        stream = reduceChatStreamLine(stream, provider, line);
        const progress = chatStreamAnswer(stream);
        // Until the turn ends, everything written so far reads as progress notes.
        const notes = [...progress.notes, progress.answer].filter(Boolean);
        const tools = stream.tools;
        updateTurn(conversation.id, turn.id, (current) => ({ ...current, notes, answer: "", tools }));
      });
      const { notes, answer } = chatStreamAnswer(stream);
      const failed = !exit.cancelled && !answer;
      const fallback = lastMeaningfulLine(exit.stderrTail);
      updateTurn(conversation.id, turn.id, (current) => ({
        ...current,
        notes,
        answer,
        tools: stream.tools.map((step) => (step.status === "running" ? { ...step, status: exit.cancelled ? "failed" : "done" } : step)),
        status: exit.cancelled ? "cancelled" : failed ? "error" : "done",
        error: failed ? stream.error ?? fallback : null,
        finishedAt: now().toISOString(),
      }));
    } catch (error) {
      updateTurn(conversation.id, turn.id, (current) => ({
        ...current,
        status: "error",
        error: errorMessage(error) || null,
        finishedAt: now().toISOString(),
      }));
    } finally {
      setRunning(null);
    }
  }, [activeId, client, connection, conversations, lang, now, running, updateTurn]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    void ask(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
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
    if (connection === "cloud") return copy.cloudPending;
    if (status && !status.toolsAvailable && status.providers.length > 0 && client.kind === "native") return copy.toolsMissing;
    const ready = availability(connection);
    if (status && !ready?.installed) return connection === "codex" ? copy.missingCodex : copy.missingClaude;
    return connection === "codex" ? copy.usageCodex : copy.usageClaude;
  })();

  const providerLabel = (provider: ChatProvider) => {
    const base = provider === "codex" ? copy.codex : copy.claude;
    return status && !availability(provider)?.installed ? base + " " + copy.notInstalled : base;
  };

  const canSend = Boolean(draft.trim()) && !running && providerReady;

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
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id} className={"chat-list__item" + (conversation.id === activeId ? " is-active" : "")}>
                <button type="button" className="chat-list__open" onClick={() => !running && setActiveId(conversation.id)} aria-current={conversation.id === activeId ? "true" : undefined}>
                  <span className="chat-list__title">{conversation.title}</span>
                  <span className="chat-list__date">{new Date(conversation.updatedAt).toLocaleDateString(lang === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" })}</span>
                </button>
                <button type="button" className="chat-list__delete" aria-label={copy.deleteConversation} onClick={() => deleteConversation(conversation.id)} disabled={running?.conversationId === conversation.id}>
                  <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
                </button>
              </li>
            ))}
          </ul>
          <p className="chat-list__foot">{copy.storedLocally}</p>
        </aside>
        <section className="chat-main" aria-label={active?.title ?? copy.newChat}>
          <div className="chat-thread" aria-live="polite">
            {turns.length === 0 ? (
              <div className="chat-empty">
                <p className="chat-empty__title">{copy.emptyTitle}</p>
                <p className="chat-empty__body">{copy.emptyBody}</p>
                <div className="chat-suggestions">
                  {copy.suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="chat-suggestion" disabled={!providerReady || Boolean(running)} onClick={() => void ask(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
                <p className="chat-empty__privacy">{copy.privacy}</p>
              </div>
            ) : turns.map((turn) => (
              <ChatTurnView key={turn.id} turn={turn} lang={lang} copy={copy} onRetry={(question) => void ask(question)} canRetry={!running && providerReady} />
            ))}
            <div ref={threadEndRef} />
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <label className="chat-sr-only" htmlFor="chat-input">{copy.placeholder}</label>
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={2}
              value={draft}
              placeholder={copy.placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="chat-composer__row">
              <label className="chat-sr-only" htmlFor="chat-connection">{copy.connection}</label>
              <select id="chat-connection" className="chat-connection" value={connection} disabled={Boolean(running)} onChange={(event) => setConnection(event.target.value as ChatConnection)}>
                <option value="codex">{providerLabel("codex")}</option>
                <option value="claude">{providerLabel("claude")}</option>
                <option value="cloud" disabled>{copy.cloudSoon}</option>
              </select>
              <p className="chat-usage">{usageLine}</p>
              {running ? (
                <button type="button" className="chat-send chat-send--stop" aria-label={copy.stop} onClick={() => void client.cancel(running.requestId)}>
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

