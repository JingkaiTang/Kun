/**
 * Mobile-side Kun mapper — aligned with desktop
 * src/renderer/src/agent/kun-mapper.ts but trimmed:
 *   - no secret redaction (mobile doesn't echo raw model output to a terminal)
 *   - no review / plan / child-agent / attachment metadata extraction
 *   - no runtime status events (tool_storm_suppressed / tool_catalog_changed / ...)
 *
 * The two exports the store consumes are:
 *   - threadFromCore / todosFromCore / chatBlockFromItem  (load/replay path)
 *   - dispatchKunRuntimeEvents / dispatchKunRuntimeEvent  (live SSE path)
 *
 * Critical contract: dispatch follows the *real* kun event kind names
 * (assistant_text_delta, item_created, tool_call_started, ...). The previous
 * mobile implementation used legacy names (assistant_text, reasoning_text,
 * tool_call_ready/finished) and read payloads from a flat `data.*` bag —
 * that did not match kun/src/contracts/events.ts and silently dropped
 * most streamed content.
 */

import type {
  ChatBlock,
  NormalizedThread,
  RuntimeDisclosureMetadata,
  ThreadDeltaEvent,
  ThreadEventSink,
  ThreadGoal,
  ThreadTodoItem,
  ThreadTodoList,
  ThreadUsageSnapshot,
  ToolBlock,
  ToolItemKind,
  UserInputQuestion,
  UserFileReference
} from './types'
import type {
  CoreRuntimeEventJson,
  CoreThreadGoalJson,
  CoreThreadSummaryJson,
  CoreThreadTodoListJson,
  CoreTurnItemJson,
  CoreUsageSnapshotJson
} from './kun-contract'

// ---------------------------------------------------------------------------
// URL helper (mirrors desktop for parity)
// ---------------------------------------------------------------------------

export function buildQuery(options: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

// ---------------------------------------------------------------------------
// Thread / goal / todos
// ---------------------------------------------------------------------------

export function threadFromCore(thread: CoreThreadSummaryJson): NormalizedThread {
  return {
    id: thread.id,
    title: thread.title?.trim() || thread.id.slice(0, 8),
    ...(thread.titleAuto !== undefined ? { titleAuto: thread.titleAuto } : {}),
    ...(thread.summary?.trim() ? { summary: thread.summary.trim() } : {}),
    updatedAt: thread.updatedAt,
    model: thread.model,
    mode: thread.mode,
    workspace: thread.workspace,
    status: thread.status,
    archived: thread.status === 'archived',
    pinned: thread.pinned === true,
    goal: thread.goal ? goalFromCore(thread.goal) : null,
    todos: thread.todos ? todosFromCore(thread.todos) : null
  }
}

export function goalFromCore(goal: CoreThreadGoalJson): ThreadGoal {
  return {
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? 0,
    timeUsedSeconds: goal.timeUsedSeconds ?? 0,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  }
}

export function todosFromCore(todos: CoreThreadTodoListJson): ThreadTodoList {
  return {
    threadId: todos.threadId,
    items: (todos.items ?? []).map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.source ? { source: { ...item.source } } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    updatedAt: todos.updatedAt
  }
}

/**
 * Strip createdAt/updatedAt from a normalized todo list to produce the
 * writable item shape (mirrors desktop threadTodoWriteItems in
 * plan-todo-sync.ts). Used before POST /v1/threads/:id/todos.
 */
export function threadTodoWriteItems(
  todos: ThreadTodoList
): Array<Pick<ThreadTodoItem, 'id' | 'content' | 'status' | 'source'>> {
  return todos.items.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
    ...(item.source ? { source: item.source } : {})
  }))
}

export function usageFromCore(usage: CoreUsageSnapshotJson): ThreadUsageSnapshot {
  const inputTokens = usage.promptTokens ?? 0
  const outputTokens = usage.completionTokens ?? 0
  const hasHitTokens = typeof usage.cacheHitTokens === 'number' && Number.isFinite(usage.cacheHitTokens)
  const hasMissTokens = typeof usage.cacheMissTokens === 'number' && Number.isFinite(usage.cacheMissTokens)
  const cachedTokens = hasHitTokens ? usage.cacheHitTokens ?? 0 : 0
  const cacheMissTokens = hasMissTokens ? usage.cacheMissTokens ?? 0 : 0
  const cacheTotal = cachedTokens + cacheMissTokens
  const cacheHitRate = typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    ? usage.cacheHitRate
    : hasHitTokens && hasMissTokens && cacheTotal > 0
      ? cachedTokens / cacheTotal
      : null
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: 0,
    cachedTokens,
    cacheMissTokens,
    cacheHitRate,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    costUsd: usage.costUsd ?? 0,
    costCny: usage.costCny ?? null,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens ?? 0,
    turns: usage.turns ?? 0
  }
}

// ---------------------------------------------------------------------------
// Item → ChatBlock (replay path)
// ---------------------------------------------------------------------------

function itemCreatedAt(item: CoreTurnItemJson): string | undefined {
  return item.createdAt || item.finishedAt
}

function toolStatus(item: CoreTurnItemJson): ToolBlock['status'] {
  if (item.isError || item.status === 'failed' || item.status === 'aborted') return 'error'
  if (item.status === 'pending' || item.status === 'running') return 'running'
  return 'success'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolBlockId(item: CoreTurnItemJson): string {
  return item.callId?.trim() ? `tool_${item.callId}` : item.id
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

function readStructuredString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const FILE_PATH_KEYS = [
  'absolute_path',
  'path',
  'file_path',
  'file',
  'relative_path',
  'target_path',
  'destination_path'
] as const

const COMMAND_KEYS = ['command', 'cmd', 'script'] as const

const COMMAND_RESULT_META_KEYS = [
  'exit_code',
  'session_id',
  'status',
  'pid',
  'shell',
  'cwd',
  'started_at',
  'finished_at',
  'partial',
  'stop_sent'
] as const

const TOOL_KIND_BY_NAME: ReadonlyMap<string, ToolItemKind> = new Map([
  ['shell', 'command_execution'],
  ['bash', 'command_execution'],
  ['terminal', 'command_execution'],
  ['run_command', 'command_execution'],
  ['exec', 'command_execution'],
  ['read', 'tool_call'],
  ['write', 'file_change'],
  ['edit', 'file_change'],
  ['grep', 'tool_call'],
  ['find', 'tool_call'],
  ['ls', 'tool_call'],
  ['write_file', 'file_change'],
  ['read_file', 'file_change'],
  ['edit_file', 'file_change'],
  ['apply_patch', 'file_change'],
  ['create_file', 'file_change'],
  ['create_plan', 'file_change']
])

function payloadFor(item: CoreTurnItemJson): Record<string, unknown> {
  if (item.kind === 'tool_result') {
    return item.output && typeof item.output === 'object'
      ? (item.output as Record<string, unknown>)
      : {}
  }
  return (item.arguments ?? {}) as Record<string, unknown>
}

function normalizeUserFileReferences(value: unknown): UserFileReference[] | undefined {
  if (!Array.isArray(value)) return undefined
  const references: UserFileReference[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : ''
    const relativePath =
      typeof raw.relativePath === 'string' && raw.relativePath.trim() ? raw.relativePath.trim() : ''
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
    const kind: 'file' | 'directory' = raw.kind === 'directory' ? 'directory' : 'file'
    if (!path || !relativePath || !name) continue
    references.push({ path, relativePath, name, kind })
  }
  return references.length > 0 ? references : undefined
}

function applyRuntimeDisclosureMeta(
  meta: Record<string, unknown>,
  item: CoreTurnItemJson
): void {
  if (item.turnId) meta.turnId = item.turnId
  const attachmentIds = stringArray(item.attachmentIds)
  const fileReferences = normalizeUserFileReferences(item.fileReferences)
  const displayText = typeof item.displayText === 'string' ? item.displayText.trim() : ''
  if (displayText && displayText !== item.text?.trim()) {
    meta.displayText = displayText
  }
  if (attachmentIds) meta.attachmentIds = attachmentIds
  if (fileReferences) meta.fileReferences = fileReferences
}

function inferToolPresentation(item: CoreTurnItemJson): {
  toolKind: ToolItemKind
  filePath?: string
  command?: string
} {
  const payload = payloadFor(item)
  const filePath = readStructuredString(payload, ...FILE_PATH_KEYS)
  const command = readStructuredString(payload, ...COMMAND_KEYS)

  if (
    item.toolKind === 'tool_call' ||
    item.toolKind === 'command_execution' ||
    item.toolKind === 'file_change'
  ) {
    return {
      toolKind: item.toolKind,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  const toolName = item.toolName?.trim() ?? ''
  const byName = TOOL_KIND_BY_NAME.get(toolName)
  if (byName) {
    return {
      toolKind: byName,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {})
    }
  }

  if (command) return { toolKind: 'command_execution', command }
  if (filePath) return { toolKind: 'file_change', filePath }
  return { toolKind: 'tool_call' }
}

function applyCommandResultMeta(meta: Record<string, unknown>, item: CoreTurnItemJson): void {
  const payload = payloadFor(item)
  for (const key of COMMAND_RESULT_META_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = value
    }
  }
}

function toolBlockFromItem(item: CoreTurnItemJson): ToolBlock {
  const detail = item.kind === 'tool_result' ? outputText(item.output) : outputText(item.arguments)
  const summary =
    item.summary?.trim() ||
    item.toolName?.trim() ||
    (item.kind === 'tool_result' ? 'tool result' : 'tool')
  const meta: Record<string, unknown> = {
    sourceItemId: item.id,
    ...(item.callId ? { callId: item.callId } : {}),
    ...(item.toolName ? { toolName: item.toolName } : {})
  }
  applyRuntimeDisclosureMeta(meta, item)
  const presentation = inferToolPresentation(item)
  if (presentation.command) meta.command = presentation.command
  if (presentation.toolKind === 'command_execution') applyCommandResultMeta(meta, item)
  return {
    kind: 'tool',
    id: toolBlockId(item),
    createdAt: itemCreatedAt(item),
    summary,
    status: toolStatus(item),
    toolKind: presentation.toolKind,
    ...(presentation.filePath ? { filePath: presentation.filePath } : {}),
    ...(detail ? { detail } : {}),
    meta
  }
}

export function mergeChatBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const merged: ChatBlock[] = []
  const toolIndexes = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'tool') {
      merged.push(block)
      continue
    }
    const existingIndex = toolIndexes.get(block.id)
    if (existingIndex === undefined) {
      toolIndexes.set(block.id, merged.length)
      merged.push(block)
      continue
    }
    const existing = merged[existingIndex]
    if (!existing || existing.kind !== 'tool') {
      merged.push(block)
      continue
    }
    merged[existingIndex] = {
      ...existing,
      ...block,
      createdAt: existing.createdAt ?? block.createdAt,
      summary: block.summary || existing.summary,
      detail: block.detail ?? existing.detail,
      filePath: block.filePath ?? existing.filePath,
      toolKind: block.toolKind ?? existing.toolKind,
      meta: { ...(existing.meta ?? {}), ...(block.meta ?? {}) }
    }
  }
  return merged
}

function userInputQuestionsFromItem(item: CoreTurnItemJson): UserInputQuestion[] {
  return questionsFromCore(item.questions, item.prompt, item.inputId ?? item.id)
}

function questionsFromCore(
  questions: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions'] | undefined,
  prompt: string | undefined,
  fallbackId: string
): UserInputQuestion[] {
  if (Array.isArray(questions) && questions.length > 0) {
    return questions
      .map((question) => normalizeUserInputQuestion(question))
      .filter((question): question is UserInputQuestion => question !== null)
  }
  return [
    {
      header: 'Input',
      id: fallbackId,
      question: prompt?.trim() || 'Input requested',
      options: []
    }
  ]
}

function normalizeUserInputQuestion(question: unknown): UserInputQuestion | null {
  if (!question || typeof question !== 'object') return null
  const raw = question as Record<string, unknown>
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option): option is UserInputQuestion['options'][number] => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : 'Input',
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'input',
    question: typeof raw.question === 'string' && raw.question.trim() ? raw.question.trim() : 'Input requested',
    options
  }
}

function normalizeUserInputOption(option: unknown): UserInputQuestion['options'][number] | null {
  if (!option || typeof option !== 'object') return null
  const raw = option as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

function userMessageBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    kind: 'user',
    id: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta: meta as RuntimeDisclosureMetadata } : {})
  }
}

function assistantTextBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'assistant', id: item.id, turnId: item.turnId, createdAt: itemCreatedAt(item), text: item.text }
}

function reasoningBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  if (!item.text?.trim()) return null
  return { kind: 'reasoning', id: item.id, createdAt: itemCreatedAt(item), text: item.text }
}

function approvalBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'approval',
    id: item.id,
    createdAt: itemCreatedAt(item),
    approvalId: item.approvalId ?? item.id,
    summary: item.summary?.trim() || 'Approval required',
    toolName: item.toolName,
    status:
      item.status === 'allowed' || item.status === 'denied'
        ? item.status
        : item.status === 'failed'
          ? 'error'
          : 'pending'
  }
}

function userInputBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'user_input',
    id: item.id,
    createdAt: itemCreatedAt(item),
    requestId: item.inputId ?? item.id,
    questions: userInputQuestionsFromItem(item),
    status:
      item.status === 'failed'
        ? 'error'
        : item.status === 'completed'
          ? 'submitted'
          : 'pending'
  }
}

function compactionBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  return {
    kind: 'compaction',
    id: item.id,
    createdAt: itemCreatedAt(item),
    summary: item.summary?.trim() || 'Context compacted',
    status: item.status === 'failed' ? 'error' : 'success',
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.join('\n'),
    auto: item.auto ?? true
  }
}

function errorSeverity(
  explicit: CoreTurnItemJson['severity'] | CoreRuntimeEventJson['severity'],
  code?: string
): 'info' | 'warning' | 'error' {
  if (explicit === 'info' || explicit === 'warning' || explicit === 'error') return explicit
  if (code === 'budget_warning' || code === 'compaction_summary_fallback') return 'warning'
  if (code === 'tool_catalog_changed' || code === 'tool_storm_suppressed') return 'info'
  return 'error'
}

function systemErrorBlockFromItem(item: CoreTurnItemJson): ChatBlock {
  const message = item.message ?? 'Runtime error'
  const parts: string[] = []
  if (item.code) parts.push(`Code: ${item.code}`)
  if (message.trim()) parts.push(`Message:\n${message}`)
  if (item.details !== undefined) {
    try {
      parts.push(`Details:\n${JSON.stringify(item.details, null, 2)}`)
    } catch {
      parts.push(`Details:\n${String(item.details)}`)
    }
  }
  const detail = parts.length > 0 ? parts.join('\n\n') : undefined
  return {
    kind: 'system',
    id: item.id,
    createdAt: itemCreatedAt(item),
    text: message,
    ...(item.code ? { code: item.code } : {}),
    ...(detail ? { detail } : {}),
    severity: errorSeverity(item.severity, item.code)
  }
}

/**
 * Build a `ChatBlock` from a turn item. Used both for replaying a
 * thread (load path) and as the canonical per-kind view that the
 * live event dispatcher maps onto sink callbacks.
 */
export function chatBlockFromItem(item: CoreTurnItemJson): ChatBlock | null {
  switch (item.kind) {
    case 'user_message':
      return userMessageBlockFromItem(item)
    case 'assistant_text':
      return assistantTextBlockFromItem(item)
    case 'assistant_reasoning':
      return reasoningBlockFromItem(item)
    case 'tool_call':
    case 'tool_result':
      return toolBlockFromItem(item)
    case 'approval':
      return approvalBlockFromItem(item)
    case 'user_input':
      return userInputBlockFromItem(item)
    case 'compaction':
      return compactionBlockFromItem(item)
    case 'error':
      return systemErrorBlockFromItem(item)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Live event dispatch (SSE path)
// ---------------------------------------------------------------------------

function userMessageEventFromItem(item: CoreTurnItemJson) {
  const meta: Record<string, unknown> = {}
  applyRuntimeDisclosureMeta(meta, item)
  return {
    itemId: item.id,
    turnId: item.turnId,
    createdAt: itemCreatedAt(item),
    text: item.text ?? '',
    ...(Object.keys(meta).length > 0 ? { meta: meta as RuntimeDisclosureMetadata } : {})
  }
}

function toolEventFromItem(item: CoreTurnItemJson) {
  const block = toolBlockFromItem(item)
  return {
    itemId: block.id,
    summary: block.summary,
    status: block.status,
    toolKind: block.toolKind,
    detail: block.detail,
    filePath: block.filePath,
    meta: block.meta
  }
}

function compactionFromItem(item: CoreTurnItemJson): {
  itemId: string
  summary: string
  status: 'running' | 'success' | 'error'
  createdAt: string | undefined
  messagesBefore: number | undefined
  detail: string | undefined
  auto: boolean
} {
  const status: 'running' | 'success' | 'error' =
    item.status === 'failed' ? 'error' : item.status === 'running' ? 'running' : 'success'
  return {
    itemId: item.id,
    summary: item.summary?.trim() || 'Context compacted',
    status,
    createdAt: itemCreatedAt(item),
    messagesBefore: item.replacedTokens,
    detail: item.pinnedConstraints?.length ? item.pinnedConstraints.join('\n') : undefined,
    auto: item.auto ?? true
  }
}

function runtimeErrorFromItem(item: CoreTurnItemJson) {
  const message = item.message ?? 'Runtime error'
  return {
    itemId: item.id,
    createdAt: itemCreatedAt(item),
    message,
    ...(item.code ? { code: item.code } : {}),
    ...(item.details !== undefined ? { details: item.details } : {}),
    severity: errorSeverity(item.severity, item.code)
  }
}

function runtimeErrorFromEvent(event: CoreRuntimeEventJson, fallback: string) {
  const message = event.message ?? fallback
  const itemId = event.itemId ?? `runtime_error_${event.turnId ?? event.threadId ?? event.seq ?? Date.now()}`
  return {
    itemId,
    createdAt: event.timestamp,
    message,
    ...(event.code ? { code: event.code } : {}),
    ...(event.details !== undefined ? { details: event.details } : {}),
    severity: errorSeverity(event.severity, event.code)
  }
}

function errorForRuntimeEvent(payload: { code?: string; message: string; details?: unknown; severity?: 'info' | 'warning' | 'error' }): Error {
  return new Error(JSON.stringify({
    ...(payload.code ? { code: payload.code } : {}),
    message: payload.message,
    ...(payload.details !== undefined ? { details: payload.details } : {}),
    ...(payload.severity ? { severity: payload.severity } : {})
  }))
}

/**
 * Dispatch a turn item to a live thread sink. The replay path uses
 * `chatBlockFromItem` directly; this function maps item snapshots onto
 * the `ThreadEventSink` callbacks that the chat store understands.
 */
function emitItem(item: CoreTurnItemJson, sink: ThreadEventSink): void {
  switch (item.kind) {
    case 'user_message':
      sink.onUserMessage(userMessageEventFromItem(item))
      return
    case 'assistant_text':
    case 'assistant_reasoning':
      // Live text/reasoning arrives through *_delta events. Item events are
      // snapshots for replay/load paths and would duplicate streamed content.
      return
    case 'tool_call':
    case 'tool_result':
      sink.onTool(toolEventFromItem(item))
      return
    // Approval and user_input have dedicated runtime events; the
    // generic item path would otherwise double-emit them.
    case 'approval':
    case 'user_input':
      return
    case 'compaction':
      sink.onCompaction(compactionFromItem(item))
      return
    case 'error':
      sink.onRuntimeError?.(runtimeErrorFromItem(item))
      return
  }
}

function emitDelta(
  event: CoreRuntimeEventJson,
  sink: ThreadEventSink,
  kind: ThreadDeltaEvent['kind']
): void {
  const text = event.item?.text ?? ''
  if (!text) return
  sink.onDeltas([{ text, kind, seq: event.seq }])
}

function compactionFromEvent(
  event: CoreRuntimeEventJson,
  status: 'running' | 'success' | 'error'
) {
  return {
    itemId: event.itemId ?? `compaction_${event.seq ?? Date.now()}`,
    summary: event.summary ?? 'Context compacted',
    status,
    createdAt: event.timestamp,
    messagesBefore: event.replacedTokens,
    detail: event.pinnedConstraints?.join('\n'),
    auto: event.auto ?? true
  }
}

function toolReadyFromEvent(event: CoreRuntimeEventJson) {
  const callId = typeof event.callId === 'string' && event.callId.trim() ? event.callId.trim() : ''
  const toolName = typeof event.toolName === 'string' && event.toolName.trim() ? event.toolName.trim() : ''
  if (!callId || !toolName) return null
  return {
    itemId: `tool_${callId}`,
    summary: toolName,
    status: 'running' as const,
    toolKind: 'tool_call' as ToolItemKind,
    meta: {
      ...(event.itemId ? { sourceItemId: event.itemId } : {}),
      callId,
      toolName,
      ...(typeof event.readyCount === 'number' ? { readyCount: event.readyCount } : {}),
      runtimeStatus: 'tool_call_ready'
    }
  }
}

function userInputRequestFromCore(input: {
  itemId?: string
  inputId?: string
  prompt?: string
  questions?: CoreTurnItemJson['questions'] | CoreRuntimeEventJson['questions']
  seq?: number
}) {
  const fallbackId = input.inputId ?? input.itemId ?? `input_${input.seq ?? Date.now()}`
  return {
    itemId: input.itemId ?? fallbackId,
    requestId: input.inputId ?? fallbackId,
    questions: questionsFromCore(input.questions, input.prompt, input.inputId ?? fallbackId)
  }
}

/**
 * Dispatches a batch of runtime events, coalescing consecutive text and
 * reasoning deltas into a single sink.onDeltas call so one network chunk
 * costs one store update instead of one per token.
 */
export async function dispatchKunRuntimeEvents(
  events: CoreRuntimeEventJson[],
  sink: ThreadEventSink
): Promise<void> {
  let pendingDeltas: ThreadDeltaEvent[] = []
  const flushDeltas = (): void => {
    if (pendingDeltas.length === 0) return
    sink.onDeltas(pendingDeltas)
    pendingDeltas = []
  }
  for (const event of events) {
    if (event.kind === 'assistant_text_delta' || event.kind === 'assistant_reasoning_delta') {
      const text = event.item?.text ?? ''
      if (text) {
        pendingDeltas.push({
          text,
          kind: event.kind === 'assistant_text_delta' ? 'agent_message' : 'agent_reasoning',
          seq: event.seq
        })
      }
      continue
    }
    flushDeltas()
    await dispatchKunRuntimeEvent(event, sink)
  }
  flushDeltas()
}

export async function dispatchKunRuntimeEvent(
  event: CoreRuntimeEventJson,
  sink: ThreadEventSink
): Promise<void> {
  if (typeof event.seq === 'number') sink.onSeq(event.seq)

  switch (event.kind) {
    case 'assistant_text_delta':
      emitDelta(event, sink, 'agent_message')
      return
    case 'assistant_reasoning_delta':
      emitDelta(event, sink, 'agent_reasoning')
      return
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished':
      if (event.item) emitItem(event.item, sink)
      return
    case 'tool_call_ready': {
      const tool = toolReadyFromEvent(event)
      if (tool) sink.onTool(tool)
      return
    }
    case 'approval_requested':
      sink.onApproval({
        approvalId: event.approvalId ?? '',
        summary: event.summary?.trim() || 'Approval required',
        ...(event.toolName ? { toolName: event.toolName } : {})
      })
      return
    case 'user_input_requested':
      sink.onUserInput(
        userInputRequestFromCore({
          itemId: event.itemId,
          inputId: event.inputId,
          prompt: event.prompt,
          questions: event.questions,
          seq: event.seq
        })
      )
      return
    case 'user_input_resolved':
      sink.onUserInputStatus({
        itemId: event.itemId ?? event.inputId ?? `input_${event.seq ?? Date.now()}`,
        status: event.status === 'cancelled' ? 'cancelled' : 'submitted'
      })
      return
    case 'compaction_started':
      sink.onCompaction(compactionFromEvent(event, 'running'))
      return
    case 'compaction_completed':
      sink.onCompaction(compactionFromEvent(event, 'success'))
      return
    case 'goal_updated':
      sink.onGoal({
        threadId: event.threadId ?? event.goal?.threadId ?? '',
        goal: event.goal ? goalFromCore(event.goal) : null,
        createdAt: event.timestamp
      })
      return
    case 'goal_cleared':
      sink.onGoal({
        threadId: event.threadId ?? '',
        goal: null,
        cleared: true,
        createdAt: event.timestamp
      })
      return
    case 'todos_updated':
      sink.onTodos?.({
        threadId: event.threadId ?? event.todos?.threadId ?? '',
        todos: event.todos ? todosFromCore(event.todos) : null,
        createdAt: event.timestamp
      })
      return
    case 'todos_cleared':
      sink.onTodos?.({
        threadId: event.threadId ?? '',
        todos: null,
        cleared: true,
        createdAt: event.timestamp
      })
      return
    case 'usage':
      if (event.usage) sink.onUsage?.(usageFromCore(event.usage))
      return
    case 'thread_updated':
      sink.onThreadUpdated?.({
        threadId: event.threadId ?? '',
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.titleAuto !== undefined ? { titleAuto: event.titleAuto } : {}),
        ...(event.status !== undefined ? { status: event.status } : {})
      })
      return
    case 'turn_completed':
    case 'turn_aborted':
      sink.onTurnComplete()
      return
    case 'turn_failed': {
      const payload = runtimeErrorFromEvent(event, 'Kun turn failed')
      sink.onRuntimeError?.(payload)
      sink.onError(errorForRuntimeEvent(payload), { terminal: true })
      return
    }
    case 'error':
      sink.onRuntimeError?.(runtimeErrorFromEvent(event, 'Runtime error'))
      return
    default:
      return
  }
}
