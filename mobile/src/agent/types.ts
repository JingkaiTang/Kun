/**
 * Mobile domain types — aligned with desktop src/renderer/src/agent/types.ts
 * but trimmed to fields the mobile companion app actually consumes.
 *
 * The mobile app does not run the agent loop; it consumes Kun over the
 * Mobile Gateway (HTTP + SSE). These types therefore model only the
 * read/interact surface, not the desktop-only concerns (worktrees, write
 * workspaces, SDD, attachments, memory, skills, child agents, review).
 */

// ---------------------------------------------------------------------------
// Tool / runtime
// ---------------------------------------------------------------------------

export type ToolItemKind = 'tool_call' | 'command_execution' | 'file_change'
export type RuntimeErrorSeverity = 'info' | 'warning' | 'error'

export type UserInputOption = {
  label: string
  description: string
}

export type UserInputQuestion = {
  header: string
  id: string
  question: string
  options: UserInputOption[]
}

export type UserInputAnswer = {
  id: string
  label: string
  value: string
}

export type UserFileReference = {
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory'
}

/** Lightweight runtime disclosure metadata attached to user messages. */
export type RuntimeDisclosureMetadata = {
  turnId?: string
  attachmentIds?: string[]
  fileReferences?: UserFileReference[]
  displayText?: string
}

// ---------------------------------------------------------------------------
// Threads / todos / goals
// ---------------------------------------------------------------------------

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export type ThreadTodoSource = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type ThreadTodoItem = {
  id: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  createdAt: string
  updatedAt: string
}

export type ThreadTodoList = {
  threadId: string
  items: ThreadTodoItem[]
  updatedAt: string
}

export type NormalizedThread = {
  id: string
  title: string
  titleAuto?: boolean
  summary?: string
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  status?: string
  archived?: boolean
  pinned?: boolean
  latestTurnId?: string
  latestTurnStatus?: string
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}

export type ThreadListOptions = {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  summary?: boolean
}

// ---------------------------------------------------------------------------
// ChatBlock union (the canonical timeline element)
// ---------------------------------------------------------------------------

export type ToolBlock = {
  kind: 'tool'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  toolKind?: ToolItemKind
  /** Full text content from runtime: stdout/stderr or unified patch text. */
  detail?: string
  /** Resolved file path for file_change items, when known. */
  filePath?: string
  /** Optional structured metadata, e.g. { exit_code, duration_ms, command }. */
  meta?: Record<string, unknown>
}

export type CompactionBlock = {
  kind: 'compaction'
  id: string
  createdAt?: string
  summary: string
  status: 'running' | 'success' | 'error'
  detail?: string
  auto?: boolean
  messagesBefore?: number
  messagesAfter?: number
}

export type ChatBlock =
  | {
      kind: 'user'
      id: string
      turnId?: string
      createdAt?: string
      text: string
      meta?: RuntimeDisclosureMetadata
    }
  | { kind: 'assistant'; id: string; turnId?: string; createdAt?: string; text: string }
  | { kind: 'reasoning'; id: string; createdAt?: string; text: string }
  | ToolBlock
  | CompactionBlock
  | {
      kind: 'system'
      id: string
      createdAt?: string
      text: string
      code?: string
      detail?: string
      severity?: RuntimeErrorSeverity
    }
  | {
      kind: 'approval'
      id: string
      createdAt?: string
      approvalId: string
      summary: string
      toolName?: string
      status: 'pending' | 'submitting' | 'allowed' | 'denied' | 'error'
      errorMessage?: string
    }
  | {
      kind: 'user_input'
      id: string
      createdAt?: string
      requestId: string
      questions: UserInputQuestion[]
      status: 'pending' | 'submitted' | 'cancelled' | 'error'
      answers?: UserInputAnswer[]
      errorMessage?: string
    }

// ---------------------------------------------------------------------------
// ThreadEventSink — what the dispatcher feeds the store with
// ---------------------------------------------------------------------------

export type ThreadDeltaEvent = {
  text: string
  kind: 'agent_message' | 'agent_reasoning'
  seq?: number
}

export type ThreadUsageSnapshot = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheHitRate: number | null
  totalTokens: number
  costUsd: number
  costCny: number | null
  tokenEconomySavingsTokens: number
  turns: number
}

export type ThreadErrorOptions = {
  terminal?: boolean
}

export type ThreadEventSink = {
  onSeq(seq: number): void
  onDeltas(deltas: ThreadDeltaEvent[]): void
  onUserMessage(ev: {
    itemId: string
    turnId?: string
    createdAt?: string
    text: string
    meta?: RuntimeDisclosureMetadata
  }): void
  onTool(ev: {
    itemId: string
    summary: string
    status: 'running' | 'success' | 'error'
    toolKind?: ToolItemKind
    detail?: string
    filePath?: string
    meta?: Record<string, unknown>
  }): void
  onCompaction(ev: {
    itemId: string
    summary: string
    status: 'running' | 'success' | 'error'
    detail?: string
    auto?: boolean
    messagesBefore?: number
    createdAt?: string
  }): void
  onApproval(req: {
    approvalId: string
    summary: string
    toolName?: string
  }): void
  onUserInput(req: {
    itemId: string
    requestId: string
    questions: UserInputQuestion[]
  }): void
  onUserInputStatus(ev: {
    itemId: string
    status: 'submitted' | 'cancelled' | 'error'
    answers?: UserInputAnswer[]
    errorMessage?: string
  }): void
  onRuntimeError?(ev: {
    itemId: string
    createdAt?: string
    message: string
    code?: string
    details?: unknown
    severity?: RuntimeErrorSeverity
  }): void
  onGoal(ev: {
    threadId: string
    goal: ThreadGoal | null
    cleared?: boolean
    createdAt?: string
  }): void
  onTodos?(ev: {
    threadId: string
    todos: ThreadTodoList | null
    cleared?: boolean
    createdAt?: string
  }): void
  onThreadUpdated?(ev: {
    threadId: string
    title?: string
    titleAuto?: boolean
    status?: string
  }): void
  onTurnComplete(): void
  onError(err: Error, options?: ThreadErrorOptions): void
  onUsage?(usage: ThreadUsageSnapshot): void
}

// ---------------------------------------------------------------------------
// AgentProvider — the runtime-facing interface the store depends on
// ---------------------------------------------------------------------------

export type ThreadDetailResult = {
  blocks: ChatBlock[]
  latestSeq: number
  threadStatus?: string
  latestTurnId?: string
  latestUserMessageId?: string
  usage?: ThreadUsageSnapshot
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}

export interface AgentProvider {
  readonly id: 'kun'
  listThreads(options?: ThreadListOptions): Promise<NormalizedThread[]>
  getThreadDetail(threadId: string): Promise<ThreadDetailResult>
  getThreadTodos(threadId: string): Promise<ThreadTodoList | null>
  sendUserMessage(threadId: string, text: string): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }>
  interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void>
  steerUserMessage(threadId: string, turnId: string, text: string): Promise<void>
  submitApprovalDecision(approvalId: string, decision: 'allow' | 'deny', remember?: boolean): Promise<void>
  submitUserInputResponse(requestId: string, answers: UserInputAnswer[]): Promise<void>
  cancelUserInput(requestId: string): Promise<void>
  getUsage(): Promise<ThreadUsageSnapshot>
  transcribeSpeech(audioBase64: string, mimeType: string, durationMs?: number): Promise<{ ok: boolean; text?: string; message?: string }>
  subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void>
}
