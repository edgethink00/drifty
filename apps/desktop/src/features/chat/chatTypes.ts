export type ChatProvider = "codex" | "claude";
export type ChatConnection = ChatProvider | "cloud";
export type ChatToolDetail = "safe" | "titles";

export type ChatToolName = "summary" | "search" | "timeline";

export type ChatToolStep = {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "done" | "failed";
};

export type ChatTurnStatus = "running" | "done" | "error" | "cancelled";

export type ChatTurn = {
  readonly id: string;
  readonly question: string;
  readonly connection: ChatConnection;
  readonly status: ChatTurnStatus;
  /** Text the agent wrote before its final answer, such as "Let me check". */
  readonly notes: readonly string[];
  readonly answer: string;
  readonly tools: readonly ChatToolStep[];
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

