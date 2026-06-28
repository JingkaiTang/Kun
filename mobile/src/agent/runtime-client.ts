/**
 * Mobile runtime client — implements AgentProvider against the Kun Mobile
 * Gateway. Replaces the desktop's `runtime-client.ts` (which wraps
 * `window.kunGui` IPC) with direct HTTP + SSE over the gateway.
 *
 * Contract:
 *   - All HTTP paths are prefixed with `/mobile` (gateway strips it).
 *   - Auth is `Authorization: Bearer <token>`.
 *   - SSE endpoint `/mobile/v1/threads/{id}/events?since_seq=N` replays
 *     persisted events with seq > since_seq, then streams live events.
 *     The runtime client tracks the last seq seen and uses it as the
 *     resume point on reconnect, so a brief network drop doesn't drop
 *     events nor replay the whole thread.
 */

import { AppState, AppStateStatus } from 'react-native'
import {
  buildQuery,
  chatBlockFromItem,
  dispatchKunRuntimeEvent,
  mergeChatBlocks,
  threadFromCore,
  todosFromCore,
  usageFromCore
} from './kun-mapper'
import { notifyAuthError, notifyNetworkError } from '../api/client'
import type {
  AgentProvider,
  NormalizedThread,
  ThreadDetailResult,
  ThreadEventSink,
  ThreadListOptions,
  ThreadTodoList,
  ThreadTodoWriteItem,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import type {
  CoreClearThreadTodosResponseJson,
  CoreRuntimeEventJson,
  CoreSetThreadTodosRequestJson,
  CoreStartTurnResponseJson,
  CoreThreadJson,
  CoreThreadSummaryJson,
  CoreThreadTodoWriteItemJson,
  CoreThreadTodosResponseJson,
  CoreTurnItemJson,
  CoreUsageSnapshotJson
} from './kun-contract'

export interface RuntimeClientConfig {
  baseUrl: string
  token: string
  /** Optional fetch impl override (testing). */
  fetchImpl?: typeof fetch
}

export class KunRuntimeClient implements AgentProvider {
  readonly id = 'kun' as const

  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(config: RuntimeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.token = config.token
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/mobile${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined)
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, headers })
    } catch (err) {
      // Network failure (DNS, connection refused, timeout). Notify the
      // connection store so the UI can show a reconnecting state.
      notifyNetworkError()
      throw err
    }
    if (response.status === 401) {
      notifyAuthError()
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const text = await response.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  async listThreads(options: ThreadListOptions = {}): Promise<NormalizedThread[]> {
    const query = buildQuery({
      limit: options.limit,
      search: options.search,
      archived: options.includeArchived ? 'true' : undefined,
      archivedOnly: options.archivedOnly ? 'true' : undefined,
      summary: options.summary ? 'true' : undefined
    })
    const data = await this.request<{ threads: CoreThreadSummaryJson[] } | CoreThreadSummaryJson[]>(`/v1/threads${query}`)
    const list = Array.isArray(data) ? data : (data.threads ?? [])
    return list.map(threadFromCore)
  }

  async getThreadDetail(threadId: string): Promise<ThreadDetailResult> {
    const data = await this.request<CoreThreadJson>(`/v1/threads/${encodeURIComponent(threadId)}`)
    const items: CoreTurnItemJson[] = []
    for (const turn of data.turns ?? []) {
      for (const item of turn.items ?? []) items.push(item)
    }
    const blocks = mergeChatBlocks(
      items
        .map(chatBlockFromItem)
        .filter((block): block is NonNullable<typeof block> => block !== null)
    )
    return {
      blocks,
      latestSeq: data.latestSeq ?? 0,
      threadStatus: data.status,
      ...(data.goal ? { goal: data.goal } : {}),
      ...(data.todos ? { todos: todosFromCore(data.todos) } : {})
    }
  }

  async getThreadTodos(threadId: string): Promise<ThreadTodoList | null> {
    const data = await this.request<CoreThreadTodosResponseJson>(
      `/v1/threads/${encodeURIComponent(threadId)}/todos`
    )
    return data.todos ? todosFromCore(data.todos) : null
  }

  async setThreadTodos(threadId: string, items: ThreadTodoWriteItem[]): Promise<ThreadTodoList> {
    const body: CoreSetThreadTodosRequestJson = {
      todos: items.map<CoreThreadTodoWriteItemJson>((item) => ({
        id: item.id,
        content: item.content,
        status: item.status,
        ...(item.source ? { source: item.source } : {})
      }))
    }
    const data = await this.request<CoreThreadTodosResponseJson>(
      `/v1/threads/${encodeURIComponent(threadId)}/todos`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    // Server always returns the persisted list on success; fall back to
    // an empty snapshot only if the gateway omitted it.
    return data.todos
      ? todosFromCore(data.todos)
      : { threadId, items: [], updatedAt: new Date().toISOString() }
  }

  async clearThreadTodos(threadId: string): Promise<boolean> {
    const data = await this.request<CoreClearThreadTodosResponseJson>(
      `/v1/threads/${encodeURIComponent(threadId)}/todos`,
      { method: 'DELETE' }
    )
    return data.cleared === true
  }

  async sendUserMessage(
    threadId: string,
    text: string
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string }> {
    const data = await this.request<CoreStartTurnResponseJson>(
      `/v1/threads/${encodeURIComponent(threadId)}/turns`,
      {
        method: 'POST',
        body: JSON.stringify({ text })
      }
    )
    return data
  }

  async interruptTurn(threadId: string, turnId: string, options: { discard?: boolean } = {}): Promise<void> {
    await this.request(
      `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      {
        method: 'POST',
        body: JSON.stringify(options.discard ? { discard: true } : {})
      }
    )
  }

  async steerUserMessage(threadId: string, turnId: string, text: string): Promise<void> {
    await this.request(
      `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/steer`,
      {
        method: 'POST',
        body: JSON.stringify({ text })
      }
    )
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny',
    remember?: boolean
  ): Promise<void> {
    await this.request(`/v1/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(remember !== undefined ? { remember } : {}) })
    })
  }

  async submitUserInputResponse(requestId: string, answers: UserInputAnswer[]): Promise<void> {
    await this.request(`/v1/user-inputs/${encodeURIComponent(requestId)}`, {
      method: 'POST',
      body: JSON.stringify({ answers })
    })
  }

  async cancelUserInput(requestId: string): Promise<void> {
    await this.request(`/v1/user-inputs/${encodeURIComponent(requestId)}`, {
      method: 'POST',
      body: JSON.stringify({ cancel: true })
    })
  }

  async getUsage(): Promise<ThreadUsageSnapshot> {
    const data = await this.request<{ usage?: CoreUsageSnapshotJson } | CoreUsageSnapshotJson>(`/v1/usage`)
    const usage = (data as { usage?: CoreUsageSnapshotJson }).usage ?? (data as CoreUsageSnapshotJson)
    return usageFromCore(usage ?? {})
  }

  async transcribeSpeech(
    audioBase64: string,
    mimeType: string,
    durationMs?: number
  ): Promise<{ ok: boolean; text?: string; message?: string }> {
    return this.request(`/v1/speech/transcribe`, {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType, ...(durationMs !== undefined ? { durationMs } : {}) })
    })
  }

  // -------------------------------------------------------------------------
  // SSE
  // -------------------------------------------------------------------------

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    let lastSeq = sinceSeq
    let appStateSubscription: { remove: () => void } | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const cleanup = (): void => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (appStateSubscription) {
        appStateSubscription.remove()
        appStateSubscription = null
      }
    }

    // When the app returns to the foreground, attempt to reconnect from
    // the last seq we saw. The OS suspends fetch on backgrounded RN apps,
    // so the in-flight stream is already dead by then.
    const handleAppState = (state: AppStateStatus): void => {
      if (state !== 'active' || stopped) return
      void connect()
    }
    appStateSubscription = AppState.addEventListener('change', handleAppState)

    signal.addEventListener('abort', cleanup)

    const connect = async (): Promise<void> => {
      if (stopped) return
      const url =
        `${this.baseUrl}/mobile/v1/threads/${encodeURIComponent(threadId)}/events` +
        `?since_seq=${lastSeq}`

      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'text/event-stream',
            // Last-Event-ID is the standard SSE resume hint; kun accepts
            // either since_seq query or this header.
            ...(lastSeq > 0 ? { 'Last-Event-ID': String(lastSeq) } : {})
          },
          signal
        })

        if (!response.ok) {
          if (response.status === 401) {
            notifyAuthError()
            sink.onError(new Error('Unauthorized – token may be invalid or expired'), { terminal: true })
            return
          }
          throw new Error(`SSE connection failed: ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No readable stream')

        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent: string | null = null
        let currentData: string[] = []
        let currentId: string | null = null

        const flushEvent = (): void => {
          if (!currentEvent && !currentData.length) {
            currentData = []
            currentId = null
            return
          }
          const dataStr = currentData.join('\n')
          if (dataStr) {
            try {
              const event = JSON.parse(dataStr) as CoreRuntimeEventJson
              // The SSE `event:` line is the kind; the JSON payload also
              // carries `kind`. Prefer the explicit kind from JSON if present
              // (more reliable across proxies), fall back to the SSE line.
              if (!event.kind && currentEvent) event.kind = currentEvent
              if (typeof event.seq === 'number' && event.seq > lastSeq) lastSeq = event.seq
              // dispatchKunRuntimeEvent is async (awaits approval handler);
              // we intentionally do not await here to keep streaming
              // throughput high — events are processed in arrival order.
              void dispatchKunRuntimeEvent(event, sink)
            } catch {
              // Non-JSON payload; ignore (likely a comment/heartbeat).
            }
          }
          currentEvent = null
          currentData = []
          currentId = null
        }

        while (!stopped) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              currentData.push(line.slice(6))
            } else if (line.startsWith('id: ')) {
              currentId = line.slice(4).trim()
            } else if (line === '') {
              // Update lastSeq from the SSE `id:` line if the payload
              // didn't carry its own seq.
              if (currentId) {
                const idNum = Number(currentId)
                if (Number.isFinite(idNum) && idNum > lastSeq) lastSeq = idNum
              }
              flushEvent()
            }
          }
        }

        // Stream ended cleanly (server closed). Reconnect from lastSeq
        // unless we were told to stop.
        if (!stopped) scheduleReconnect(1000)
      } catch (err) {
        if (stopped || (err as Error)?.name === 'AbortError') return
        sink.onError(err instanceof Error ? err : new Error(String(err)))
        if (!stopped) scheduleReconnect(1000)
      }
    }

    const scheduleReconnect = (delayMs: number): void => {
      if (stopped) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, delayMs)
    }

    await connect()
    // If connect() returns (clean close), the cleanup above may already
    // have run. If we got here without abort, the subscription is idle.
    if (!stopped && !signal.aborted) {
      signal.removeEventListener('abort', cleanup)
    }
  }
}
