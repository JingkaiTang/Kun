/**
 * Kun HTTP/SSE DTO types — mobile-side mirror of the contract defined in
 * kun/src/contracts/{events,items,threads}.ts. Mobile uses pure types
 * (no zod) because it only validates structurally against the gateway.
 *
 * Aligned with desktop src/renderer/src/agent/kun-contract.ts but trimmed
 * to DTOs the mobile companion app consumes (no attachments, memory,
 * skills, capabilities, review).
 */

export type CoreThreadStatus = 'idle' | 'running' | 'archived' | 'deleted'
export type CoreTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
export type CoreItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'allowed'
  | 'denied'
  | 'expired'
  | string

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export type CoreThreadSummaryJson = {
  id: string
  title: string
  titleAuto?: boolean
  summary?: string
  workspace?: string
  model: string
  mode: string
  status: CoreThreadStatus
  pinned?: boolean
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  createdAt: string
  updatedAt: string
}

export type CoreThreadJson = CoreThreadSummaryJson & {
  turns?: CoreTurnJson[]
  latestSeq?: number
}

export type CoreTurnJson = {
  id: string
  threadId: string
  status: CoreTurnStatus
  prompt: string
  model?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  items?: CoreTurnItemJson[]
  error?: string
}

// ---------------------------------------------------------------------------
// Turn items (the persistent record a thread is replayed from)
// ---------------------------------------------------------------------------

export type CoreUserFileReferenceJson = {
  path: string
  relativePath: string
  name: string
  kind?: 'file' | 'directory'
}

export type CoreTurnItemJson = {
  id: string
  turnId: string
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: CoreItemStatus
  createdAt: string
  finishedAt?: string
  kind: string
  text?: string
  displayText?: string
  toolName?: string
  callId?: string
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
  approvalId?: string
  inputId?: string
  prompt?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  summary?: string
  replacedTokens?: number
  auto?: boolean
  pinnedConstraints?: string[]
  message?: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
  attachmentIds?: string[]
  fileReferences?: CoreUserFileReferenceJson[]
}

// ---------------------------------------------------------------------------
// Todos / goals
// ---------------------------------------------------------------------------

export type CoreThreadGoalStatusJson =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type CoreThreadGoalJson = {
  threadId: string
  objective: string
  status: CoreThreadGoalStatusJson
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export type CoreThreadTodoStatusJson = 'pending' | 'in_progress' | 'completed'

export type CoreThreadTodoSourceJson = {
  kind: 'plan'
  planId: string
  relativePath: string
  ordinal: number
  contentHash: string
}

export type CoreThreadTodoItemJson = {
  id: string
  content: string
  status: CoreThreadTodoStatusJson
  source?: CoreThreadTodoSourceJson
  createdAt: string
  updatedAt: string
}

export type CoreThreadTodoListJson = {
  threadId: string
  items: CoreThreadTodoItemJson[]
  updatedAt: string
}

export type CoreThreadTodosResponseJson = {
  todos: CoreThreadTodoListJson | null
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type CoreUsageSnapshotJson = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
  cacheHitRate?: number
  turns?: number
  costUsd?: number
  costCny?: number
  tokenEconomySavingsTokens?: number
}

// ---------------------------------------------------------------------------
// Start-turn response
// ---------------------------------------------------------------------------

export type CoreStartTurnResponseJson = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

// ---------------------------------------------------------------------------
// Runtime events (the SSE payload contract)
// ---------------------------------------------------------------------------

export type CoreRuntimeEventJson = {
  kind?: string
  seq?: number
  timestamp?: string
  threadId?: string
  turnId?: string
  itemId?: string
  item?: CoreTurnItemJson
  approvalId?: string
  toolName?: string
  callId?: string
  readyCount?: number
  toolResultCount?: number
  status?: string
  /** thread_created / thread_updated: the thread's (possibly upgraded) title. */
  title?: string
  /** thread_created / thread_updated: whether that title is auto/provisional. */
  titleAuto?: boolean
  summary?: string
  prompt?: string
  inputId?: string
  questions?: Array<{
    header: string
    id: string
    question: string
    options: Array<{ label: string; description: string }>
  }>
  replacedTokens?: number
  auto?: boolean
  pinnedConstraints?: string[]
  usage?: CoreUsageSnapshotJson
  goal?: CoreThreadGoalJson | null
  todos?: CoreThreadTodoListJson | null
  cleared?: boolean
  message?: string
  code?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}

export type RuntimeErrorJson = {
  code?: string
  error?: string | { message?: string; status?: number }
  message?: string
  details?: unknown
  severity?: 'info' | 'warning' | 'error'
}
