/**
 * Mobile chat store — Zustand store that owns thread list, active thread
 * timeline, live SSE buffers, busy/turn tracking, and approval/user-input
 * block status. Aligned with desktop src/renderer/src/store/chat-store.ts
 * but trimmed:
 *   - no claw / side conversations / write worktree / review / plan
 *   - no busy watchdog (mobile relies on since_seq resume + AppState
 *     reconnect inside KunRuntimeClient.subscribeThreadEvents)
 *   - no optimistic user-block reconciliation (mobile sends and waits
 *     for the server's item_created event; the optimistic block is
 *     replaced in place when onUserMessage arrives)
 *
 * The store consumes the agent/ layer (AgentProvider + ThreadEventSink)
 * and is the only consumer of SSE on mobile.
 */

import { create } from 'zustand'
import { KunRuntimeClient } from '../agent/runtime-client'
import { chatBlockFromItem, mergeChatBlocks, threadFromCore } from '../agent/kun-mapper'
import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  NormalizedThread,
  ThreadDeltaEvent,
  ThreadEventSink,
  ThreadGoal,
  ThreadTodoList,
  ToolBlock,
  UserInputAnswer,
  UserInputQuestion
} from '../agent/types'
import type { CoreTurnItemJson } from '../agent/kun-contract'
import { useConnectionStore } from './connection'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type ChatState = {
  threads: NormalizedThread[]
  threadsLoading: boolean
  activeThreadId: string | null
  /** Snapshot of the active thread's todos (kept in sync via SSE + HTTP). */
  activeThreadTodos: ThreadTodoList | null
  activeThreadGoal: ThreadGoal | null
  /** Flat timeline blocks for the active thread (committed items only). */
  blocks: ChatBlock[]
  /** Streaming reasoning text not yet committed to a block. */
  liveReasoning: string
  /** Streaming assistant text not yet committed to a block. */
  liveAssistant: string
  /** Monotonic high-water mark of SSE seq consumed for the active thread. */
  lastSeq: number
  busy: boolean
  currentTurnId: string | null
  currentTurnUserId: string | null
  error: string | null
  /** Per-block approval resolution state, keyed by block id. */
  approvalStatusByBlock: Record<string, 'pending' | 'submitting' | 'allowed' | 'denied' | 'error'>
  /** Per-block user-input resolution state, keyed by block id. */
  userInputStatusByBlock: Record<string, 'pending' | 'submitting' | 'submitted' | 'cancelled' | 'error'>

  // Actions --------------------------------------------------------------
  refreshThreads: () => Promise<void>
  selectThread: (threadId: string) => Promise<void>
  closeThread: () => void
  sendMessage: (text: string) => Promise<boolean>
  interrupt: (options?: { discard?: boolean }) => Promise<void>
  steer: (text: string) => Promise<void>
  resolveApproval: (blockId: string, decision: 'allow' | 'deny') => Promise<void>
  resolveUserInput: (
    blockId: string,
    action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
  ) => Promise<void>
  clearError: () => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Flush liveReasoning / liveAssistant into committed blocks. Reasoning
 * segments become their own blocks (so each turn's thinking is visible
 * as a separate collapsible section); assistant text becomes one block.
 * Returns the new blocks + emptied buffers, or {} if nothing to flush.
 */
function flushLiveBlocks(state: ChatState): Partial<ChatState> {
  const flushed: ChatBlock[] = []
  if (state.liveReasoning.trim()) {
    flushed.push({
      kind: 'reasoning',
      id: `reasoning_${state.currentTurnUserId ?? Date.now()}_${flushed.length}`,
      text: state.liveReasoning
    })
  }
  if (state.liveAssistant.trim()) {
    flushed.push({
      kind: 'assistant',
      id: `assistant_${state.currentTurnUserId ?? Date.now()}`,
      turnId: state.currentTurnId ?? undefined,
      text: state.liveAssistant
    })
  }
  if (flushed.length === 0) return {}
  return {
    blocks: [...state.blocks, ...flushed],
    liveReasoning: '',
    liveAssistant: ''
  }
}

/**
 * Build a ThreadEventSink that mutates the store. Mirrors desktop
 * buildThreadEventSink but without watchdog/recovery/review/claw hooks.
 * `boundThreadId` guards against stale events from a previous thread
 * leaking into the active timeline after the user switches threads.
 */
function buildThreadEventSink(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  boundThreadId: string
): ThreadEventSink {
  const isCurrentStream = (): boolean => {
    const state = get()
    return state.activeThreadId === boundThreadId
  }

  return {
    onSeq: (seq) => {
      if (!isCurrentStream()) return
      set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) }))
    },

    onDeltas: (deltas: ThreadDeltaEvent[]) => {
      if (!isCurrentStream()) return
      if (deltas.length === 0) return
      set((s) => {
        let liveReasoning = s.liveReasoning
        let liveAssistant = s.liveAssistant
        let nextLastSeq = s.lastSeq
        for (const delta of deltas) {
          if (typeof delta.seq === 'number' && delta.seq > nextLastSeq) nextLastSeq = delta.seq
          if (delta.kind === 'agent_reasoning') liveReasoning += delta.text
          else liveAssistant += delta.text
        }
        return {
          liveReasoning,
          liveAssistant,
          lastSeq: nextLastSeq,
          // Restore busy if deltas arrive on a stream we thought was idle
          // (e.g. app foregrounded mid-turn).
          ...(s.busy ? {} : { busy: true })
        }
      })
    },

    onUserMessage: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        // Replace the optimistic user block (id === currentTurnUserId)
        // with the server-confirmed one, or append if no optimistic block.
        let blocks: ChatBlock[]
        const optimisticId = s.currentTurnUserId
        if (optimisticId && optimisticId !== ev.itemId) {
          blocks = baseBlocks.map((block) =>
            block.kind === 'user' && block.id === optimisticId
              ? {
                  kind: 'user',
                  id: ev.itemId,
                  turnId: ev.turnId,
                  createdAt: ev.createdAt,
                  text: ev.text,
                  ...(ev.meta ? { meta: ev.meta } : {})
                }
              : block
          )
        } else if (baseBlocks.some((b) => b.kind === 'user' && b.id === ev.itemId)) {
          blocks = baseBlocks
        } else {
          blocks = [
            ...baseBlocks,
            {
              kind: 'user',
              id: ev.itemId,
              turnId: ev.turnId,
              createdAt: ev.createdAt,
              text: ev.text,
              ...(ev.meta ? { meta: ev.meta } : {})
            }
          ]
        }
        return {
          ...flushed,
          blocks,
          busy: true,
          currentTurnId: ev.turnId ?? s.currentTurnId,
          currentTurnUserId: ev.itemId,
          error: null
        }
      })
    },

    onTool: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'tool') return {}
          const next: ToolBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            toolKind: ev.toolKind ?? cur.toolKind,
            detail: ev.detail ?? cur.detail,
            filePath: ev.filePath ?? cur.filePath,
            meta: ev.meta ?? cur.meta
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return { blocks, ...(s.busy ? {} : { busy: true }) }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ToolBlock = {
          kind: 'tool',
          id: ev.itemId,
          createdAt: new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          toolKind: ev.toolKind,
          detail: ev.detail,
          filePath: ev.filePath,
          meta: ev.meta
        }
        return { ...flushed, blocks: [...baseBlocks, block], ...(s.busy ? {} : { busy: true }) }
      })
    },

    onCompaction: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.kind === 'compaction' && b.id === ev.itemId)
        if (idx >= 0) {
          const cur = s.blocks[idx]
          if (cur.kind !== 'compaction') return {}
          const next: CompactionBlock = {
            ...cur,
            summary: ev.summary || cur.summary,
            status: ev.status,
            detail: ev.detail ?? cur.detail,
            auto: ev.auto ?? cur.auto,
            messagesBefore: ev.messagesBefore ?? cur.messagesBefore
          }
          const blocks = [...s.blocks]
          blocks[idx] = next
          return { blocks }
        }
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: CompactionBlock = {
          kind: 'compaction',
          id: ev.itemId,
          createdAt: ev.createdAt ?? new Date().toISOString(),
          summary: ev.summary,
          status: ev.status,
          detail: ev.detail,
          auto: ev.auto,
          messagesBefore: ev.messagesBefore
        }
        return { ...flushed, blocks: [...baseBlocks, block] }
      })
    },

    onApproval: (req) => {
      if (!isCurrentStream()) return
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        // Skip if an approval block with the same id already exists
        // (e.g. replay after since_seq resume).
        if (baseBlocks.some((b) => b.kind === 'approval' && b.approvalId === req.approvalId)) {
          return {}
        }
        const block: ChatBlock = {
          kind: 'approval',
          id: `approval_${req.approvalId}`,
          approvalId: req.approvalId,
          summary: req.summary,
          toolName: req.toolName,
          status: 'pending'
        }
        return {
          ...flushed,
          blocks: [...baseBlocks, block],
          approvalStatusByBlock: {
            ...s.approvalStatusByBlock,
            [`approval_${req.approvalId}`]: 'pending'
          }
        }
      })
    },

    onUserInput: (req) => {
      if (!isCurrentStream()) return
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        if (baseBlocks.some((b) => b.kind === 'user_input' && b.requestId === req.requestId)) {
          return {}
        }
        const blockId = `user_input_${req.requestId}`
        const block: ChatBlock = {
          kind: 'user_input',
          id: blockId,
          requestId: req.requestId,
          questions: req.questions,
          status: 'pending'
        }
        return {
          ...flushed,
          blocks: [...baseBlocks, block],
          userInputStatusByBlock: {
            ...s.userInputStatusByBlock,
            [blockId]: 'pending'
          }
        }
      })
    },

    onUserInputStatus: (ev) => {
      if (!isCurrentStream()) return
      const nextStatus: 'submitted' | 'cancelled' =
        ev.status === 'cancelled' ? 'cancelled' : 'submitted'
      set((s) => {
        const blocks: ChatBlock[] = s.blocks.map((block) =>
          block.kind === 'user_input' && block.id === ev.itemId
            ? {
                ...block,
                status: nextStatus,
                ...(ev.answers ? { answers: ev.answers } : {}),
                ...(ev.errorMessage ? { errorMessage: ev.errorMessage } : {})
              }
            : block
        )
        return {
          blocks,
          userInputStatusByBlock: {
            ...s.userInputStatusByBlock,
            [ev.itemId]: nextStatus
          }
        }
      })
    },

    onRuntimeError: (ev) => {
      if (!isCurrentStream()) return
      set((s) => {
        const flushed = flushLiveBlocks(s)
        const baseBlocks = flushed.blocks ?? s.blocks
        const block: ChatBlock = {
          kind: 'system',
          id: ev.itemId,
          createdAt: ev.createdAt,
          text: ev.message,
          ...(ev.code ? { code: ev.code } : {}),
          ...(ev.details !== undefined ? { detail: JSON.stringify(ev.details, null, 2) } : {}),
          severity: ev.severity ?? 'error'
        }
        return { ...flushed, blocks: [...baseBlocks, block] }
      })
    },

    onGoal: (ev) => {
      if (!isCurrentStream()) return
      set({ activeThreadGoal: ev.goal })
    },

    onTodos: (ev) => {
      if (!isCurrentStream()) return
      set({ activeThreadTodos: ev.todos })
      // Also keep the threads list entry in sync so the list progress
      // indicator updates without a full refresh.
      if (ev.todos) {
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === boundThreadId ? { ...t, todos: ev.todos ?? null } : t
          )
        }))
      }
    },

    onThreadUpdated: (ev) => {
      set((s) => ({
        threads: s.threads.map((t) =>
          t.id === ev.threadId
            ? {
                ...t,
                ...(ev.title !== undefined ? { title: ev.title } : {}),
                ...(ev.titleAuto !== undefined ? { titleAuto: ev.titleAuto } : {}),
                ...(ev.status !== undefined ? { status: ev.status, archived: ev.status === 'archived' } : {})
              }
            : t
        )
      }))
    },

    onTurnComplete: () => {
      if (!isCurrentStream()) return
      set((s) => {
        const flushed = flushLiveBlocks(s)
        return {
          ...flushed,
          busy: false,
          currentTurnId: null,
          currentTurnUserId: null
        }
      })
    },

    onError: (err, options) => {
      if (!isCurrentStream()) return
      set({
        error: err.message,
        ...(options?.terminal ? { busy: false, currentTurnId: null, currentTurnUserId: null } : {})
      })
    },

    onUsage: (_usage) => {
      // Usage is fetched on demand by the usage screen; the live usage
      // event is a no-op here to avoid storing per-thread snapshots we
      // never read.
    }
  }
}

// ---------------------------------------------------------------------------
// Provider accessor
// ---------------------------------------------------------------------------

let activeProvider: KunRuntimeClient | null = null
let activeAbortController: AbortController | null = null

function getProvider(): KunRuntimeClient {
  if (activeProvider) return activeProvider
  const { baseUrl, token } = useConnectionStore.getState()
  if (!baseUrl || !token) {
    throw new Error('Not connected to a Kun desktop')
  }
  activeProvider = new KunRuntimeClient({ baseUrl, token })
  return activeProvider
}

function resetProvider(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
  }
  activeProvider = null
}

function buildBlocksFromItems(items: CoreTurnItemJson[]): ChatBlock[] {
  return mergeChatBlocks(
    items
      .map(chatBlockFromItem)
      .filter((block): block is ChatBlock => block !== null)
  )
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  threadsLoading: false,
  activeThreadId: null,
  activeThreadTodos: null,
  activeThreadGoal: null,
  blocks: [],
  liveReasoning: '',
  liveAssistant: '',
  lastSeq: 0,
  busy: false,
  currentTurnId: null,
  currentTurnUserId: null,
  error: null,
  approvalStatusByBlock: {},
  userInputStatusByBlock: {},

  refreshThreads: async () => {
    set({ threadsLoading: true })
    try {
      const provider = getProvider()
      const threads = await provider.listThreads()
      set({ threads, threadsLoading: false, error: null })
    } catch (err) {
      set({
        threadsLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load threads'
      })
    }
  },

  selectThread: async (threadId: string) => {
    // Abort any existing subscription and reset provider so the new
    // subscription uses the current connection credentials.
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
    if (get().activeThreadId === threadId) return

    set({
      activeThreadId: threadId,
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      lastSeq: 0,
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      error: null,
      activeThreadTodos: null,
      activeThreadGoal: null,
      approvalStatusByBlock: {},
      userInputStatusByBlock: {}
    })

    const provider = getProvider()

    // 1. Load thread detail (replay path) — populates blocks + latestSeq.
    try {
      const detail = await provider.getThreadDetail(threadId)
      set({
        blocks: detail.blocks,
        lastSeq: detail.latestSeq,
        activeThreadTodos: detail.todos ?? null,
        ...(detail.goal !== undefined ? { activeThreadGoal: detail.goal } : {})
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load thread' })
      return
    }

    // 2. Subscribe to live events from lastSeq. The sink is bound to
    //    this thread id so stale events from a previous subscription
    //    can't leak in after the user switches threads.
    const sink = buildThreadEventSink(set, get, threadId)
    const controller = new AbortController()
    activeAbortController = controller
    void provider.subscribeThreadEvents(threadId, get().lastSeq, sink, controller.signal)
  },

  closeThread: () => {
    if (activeAbortController) {
      activeAbortController.abort()
      activeAbortController = null
    }
    set({
      activeThreadId: null,
      blocks: [],
      liveReasoning: '',
      liveAssistant: '',
      lastSeq: 0,
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      activeThreadTodos: null,
      activeThreadGoal: null,
      approvalStatusByBlock: {},
      userInputStatusByBlock: {}
    })
  },

  sendMessage: async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return false
    const state = get()
    if (!state.activeThreadId) return false

    const provider = getProvider()
    const threadId = state.activeThreadId

    // Optimistic user block — replaced when onUserMessage arrives with
    // the server-assigned itemId.
    const optimisticId = `optimistic_${Date.now()}`
    set((s) => ({
      blocks: [
        ...s.blocks,
        {
          kind: 'user',
          id: optimisticId,
          text: trimmed,
          createdAt: new Date().toISOString()
        }
      ],
      currentTurnUserId: optimisticId,
      busy: true,
      error: null
    }))

    try {
      const result = await provider.sendUserMessage(threadId, trimmed)
      // The server returns the turnId immediately; the user_message item
      // arrives via SSE as item_created/onUserMessage. We set currentTurnId
      // here so interrupt works even before the SSE event lands.
      set({ currentTurnId: result.turnId })
      return true
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : 'Failed to send message',
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        // Mark the optimistic block as a system error so the user sees
        // the send failed rather than a stuck "sending" bubble.
        blocks: s.blocks.map((b) =>
          b.kind === 'user' && b.id === optimisticId
            ? { kind: 'system', id: optimisticId, text: `Failed to send: ${err instanceof Error ? err.message : 'network error'}`, severity: 'error' }
            : b
        )
      }))
      return false
    }
  },

  interrupt: async (options = {}) => {
    const state = get()
    if (!state.activeThreadId || !state.currentTurnId) return
    const provider = getProvider()
    try {
      await provider.interruptTurn(state.activeThreadId, state.currentTurnId, options)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to interrupt' })
    }
  },

  steer: async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const state = get()
    if (!state.activeThreadId || !state.currentTurnId) return
    const provider = getProvider()
    try {
      await provider.steerUserMessage(state.activeThreadId, state.currentTurnId, trimmed)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to steer' })
    }
  },

  resolveApproval: async (blockId, decision) => {
    const state = get()
    const block = state.blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'approval') return
    set((s) => ({
      approvalStatusByBlock: { ...s.approvalStatusByBlock, [blockId]: 'submitting' }
    }))
    const provider = getProvider()
    try {
      await provider.submitApprovalDecision(block.approvalId, decision)
      set((s) => ({
        approvalStatusByBlock: { ...s.approvalStatusByBlock, [blockId]: decision === 'allow' ? 'allowed' : 'denied' },
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval' ? { ...b, status: decision === 'allow' ? 'allowed' : 'denied' } : b
        )
      }))
    } catch (err) {
      set((s) => ({
        approvalStatusByBlock: { ...s.approvalStatusByBlock, [blockId]: 'error' },
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'approval'
            ? { ...b, status: 'error', errorMessage: err instanceof Error ? err.message : 'Failed' }
            : b
        ),
        error: err instanceof Error ? err.message : 'Failed to resolve approval'
      }))
    }
  },

  resolveUserInput: async (blockId, action) => {
    const state = get()
    const block = state.blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'user_input') return
    set((s) => ({
      userInputStatusByBlock: { ...s.userInputStatusByBlock, [blockId]: 'submitting' }
    }))
    const provider = getProvider()
    try {
      if (action.kind === 'cancel') {
        await provider.cancelUserInput(block.requestId)
        set((s) => ({
          userInputStatusByBlock: { ...s.userInputStatusByBlock, [blockId]: 'cancelled' },
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'user_input' ? { ...b, status: 'cancelled' } : b
          )
        }))
      } else {
        await provider.submitUserInputResponse(block.requestId, action.answers)
        set((s) => ({
          userInputStatusByBlock: { ...s.userInputStatusByBlock, [blockId]: 'submitted' },
          blocks: s.blocks.map((b) =>
            b.id === blockId && b.kind === 'user_input'
              ? { ...b, status: 'submitted', answers: action.answers }
              : b
          )
        }))
      }
    } catch (err) {
      set((s) => ({
        userInputStatusByBlock: { ...s.userInputStatusByBlock, [blockId]: 'error' },
        blocks: s.blocks.map((b) =>
          b.id === blockId && b.kind === 'user_input'
            ? { ...b, status: 'error', errorMessage: err instanceof Error ? err.message : 'Failed' }
            : b
        ),
        error: err instanceof Error ? err.message : 'Failed to submit input'
      }))
    }
  },

  clearError: () => set({ error: null })
}))

// ---------------------------------------------------------------------------
// Connection lifecycle — when the user switches connections or disconnects,
// reset the provider so the next call uses the new credentials, and close
// the active thread so stale state doesn't leak across connections.
// ---------------------------------------------------------------------------

let lastConnectionKey: string | null = null
useConnectionStore.subscribe((state) => {
  // Identity is baseUrl+token; status transitions alone don't reset the
  // provider (reconnects happen inside KunRuntimeClient.subscribeThreadEvents).
  const currentKey = state.status === 'connected' ? `${state.baseUrl}::${state.token}` : null
  if (currentKey !== lastConnectionKey) {
    lastConnectionKey = currentKey
    if (currentKey === null) {
      resetProvider()
      useChatStore.getState().closeThread()
      useChatStore.setState({ threads: [] })
    } else {
      // Connected (or switched gateways) — reset the provider so the next
      // call picks up the new credentials, but keep the thread list for
      // a same-gateway reconnect.
      resetProvider()
    }
  }
})

// Re-export for consumers that need the provider type (e.g. tests).
export type { AgentProvider, UserInputQuestion }
