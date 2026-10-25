import type { ChatAttachmentMeta } from "./chatAttachments";

export type ChatProvider = "codex" | "claude";
export type ChatConnection = ChatProvider | "cloud";
export type ChatToolDetail = "safe" | "titles";

export type ChatToolName = "summary" | "search" | "timeline";

export type ChatToolStep = {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "done" | "failed";
  /** What the tool returned, clipped; kept with the chat on this computer. */
  readonly result?: string;
};

export type ChatTurnStatus = "running" | "done" | "error" | "cancelled";

/** The user's rating of an answer: 좋아요 or 별로예요. */
export type ChatFeedback = "good" | "bad";

export type ChatTurn = {
  readonly id: string;
  /** What the conversation shows: the typed question, or a task's short title. */
  readonly question: string;
  /** The full request as sent (a task's fuller request, attached documents); absent when it equals the question. */
  readonly prompt?: string;
  /** Documents attached to the question, shown under it; their text is in prompt. */
  readonly attachments?: readonly ChatAttachmentMeta[];
  readonly connection: ChatConnection;
  /** Drifty Cloud model label for this turn, such as "Sonnet 5.5". */
  readonly model?: string;
  /** Drifty Cloud credits this turn used. */
  readonly charged?: number;
  readonly status: ChatTurnStatus;
  /** Text the agent wrote before its final answer, such as "Let me check". */
  readonly notes: readonly string[];
  readonly answer: string;
  readonly tools: readonly ChatToolStep[];
  /** Follow-up questions the agent offered after this answer. */
  readonly suggestions?: readonly string[];
  /** The user's rating of this answer, if any. */
  readonly feedback?: ChatFeedback;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
};

export type ChatConversation = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: readonly ChatTurn[];
};

export type ChatProviderAvailability = {
  readonly provider: ChatProvider;
  readonly installed: boolean;
  readonly version: string | null;
};

export type ChatRuntimeStatus = {
  readonly providers: readonly ChatProviderAvailability[];
  readonly toolsAvailable: boolean;
  readonly toolsMessage: string | null;
};

export type ChatRunExit = {
  readonly code: number | null;
  readonly cancelled: boolean;
  readonly stderrTail: string;
};

