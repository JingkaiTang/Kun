import { create } from 'zustand';
import type { ChatBlock, Approval, UserInputRequest, SSEEvent, TodoItem, UsageInfo } from '../types/api';
import { SSEClient } from '../api/sse';
import { useThreadsStore } from './threads';

interface EventsState {
  chatBlocks: Record<string, ChatBlock[]>;
  approvals: Record<string, Approval[]>;
  userInputs: Record<string, UserInputRequest[]>;
  usage: Record<string, UsageInfo>;
  sseClient: SSEClient | null;

  connectSSE: (baseUrl: string, token: string, threadId: string) => void;
  disconnectSSE: () => void;
  addChatBlock: (threadId: string, block: ChatBlock) => void;
  setChatBlocks: (threadId: string, blocks: ChatBlock[]) => void;
  removeApproval: (threadId: string, approvalId: string) => void;
  removeUserInput: (threadId: string, inputId: string) => void;
  clearThread: (threadId: string) => void;
}

let currentBlockId = 0;
function nextBlockId(): string {
  return `block_${++currentBlockId}_${Date.now()}`;
}

function handleSSEEvent(
  event: SSEEvent,
  set: any,
  get: () => EventsState,
) {
  const { kind, data } = event;
  const threadId = event.threadId || 'unknown';

  switch (kind) {
    case 'turn_started': {
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'system' as const,
              content: 'Turn started...',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      break;
    }

    case 'assistant_text': {
      const text = data.text || data.content || data.delta || '';
      if (!text) break;
      set((state: EventsState) => {
        const blocks = [...(state.chatBlocks[threadId] || [])];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.kind === 'assistant_text') {
          blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + text };
          return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
        }
        return {
          chatBlocks: {
            ...state.chatBlocks,
            [threadId]: [
              ...blocks,
              {
                id: nextBlockId(),
                kind: 'assistant_text' as const,
                content: text,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        };
      });
      break;
    }

    case 'tool_call_ready': {
      const toolName = data.name || data.tool || 'unknown';
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'tool_call' as const,
              content: data.summary || `Running ${toolName}...`,
              toolName,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      break;
    }

    case 'tool_call_finished': {
      const toolName = data.name || data.tool || 'unknown';
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'tool_result' as const,
              content: data.summary || data.result || `✓ ${toolName} finished`,
              toolName,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      break;
    }

    case 'approval_requested': {
      const approval: Approval = {
        id: data.id || data.approvalId || nextBlockId(),
        threadId,
        turnId: data.turnId || '',
        kind: data.kind || data.type || 'approval',
        summary: data.summary || data.message || 'Approval requested',
        detail: data.detail || data.description,
        createdAt: new Date().toISOString(),
      };
      set((state: EventsState) => ({
        approvals: {
          ...state.approvals,
          [threadId]: [...(state.approvals[threadId] || []), approval],
        },
      }));
      break;
    }

    case 'user_input_requested': {
      const input: UserInputRequest = {
        id: data.id || data.inputId || nextBlockId(),
        threadId,
        turnId: data.turnId || '',
        prompt: data.prompt || data.message || 'Input requested',
        options: data.options,
        createdAt: new Date().toISOString(),
      };
      set((state: EventsState) => ({
        userInputs: {
          ...state.userInputs,
          [threadId]: [...(state.userInputs[threadId] || []), input],
        },
      }));
      break;
    }

    case 'user_input_resolved': {
      const inputId = data.id || data.inputId;
      if (inputId) {
        set((state: EventsState) => ({
          userInputs: {
            ...state.userInputs,
            [threadId]: (state.userInputs[threadId] || []).filter(
              (u: UserInputRequest) => u.id !== inputId,
            ),
          },
        }));
      }
      break;
    }

    case 'todos_updated': {
      const todos: TodoItem[] = data.todos || data.items || [];
      useThreadsStore.getState().updateTodos(threadId, todos);
      break;
    }

    case 'todos_cleared': {
      useThreadsStore.getState().clearTodos(threadId);
      break;
    }

    case 'usage': {
      set((state: EventsState) => ({
        usage: {
          ...state.usage,
          [threadId]: {
            promptTokens: data.promptTokens || 0,
            completionTokens: data.completionTokens || 0,
            totalTokens: data.totalTokens || 0,
            promptCacheHitTokens: data.promptCacheHitTokens,
            promptCacheMissTokens: data.promptCacheMissTokens,
            turns: data.turns || 0,
            cost: data.cost,
          },
        },
      }));
      break;
    }

    case 'turn_completed': {
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'system' as const,
              content: 'Turn completed',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      useThreadsStore.getState().fetchThreads().catch(() => {});
      break;
    }

    case 'turn_failed': {
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'error' as const,
              content: data.error || data.message || 'Turn failed',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      break;
    }

    case 'error': {
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            {
              id: nextBlockId(),
              kind: 'error' as const,
              content: data.message || data.error || 'An error occurred',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }));
      break;
    }
  }
}

export const useEventsStore = create<EventsState>((set, get) => ({
  chatBlocks: {},
  approvals: {},
  userInputs: {},
  usage: {},
  sseClient: null,

  connectSSE: (baseUrl: string, token: string, threadId: string) => {
    const existing = get().sseClient;
    if (existing) {
      existing.disconnect();
    }

    const client = new SSEClient();

    client.connect(
      baseUrl,
      token,
      threadId,
      (event: SSEEvent) => {
        handleSSEEvent(event, set, get);
      },
      (status) => {
        // Lazy require to avoid circular dependency
        const { useConnectionStore } = require('./connection');
        if (status === 'connected') {
          useConnectionStore.getState().setStatus('connected');
        } else if (status === 'reconnecting') {
          useConnectionStore.getState().setStatus('reconnecting');
        } else if (status === 'disconnected') {
          useConnectionStore.getState().setStatus('disconnected');
        }
      },
    );

    set({ sseClient: client });
  },

  disconnectSSE: () => {
    const client = get().sseClient;
    if (client) {
      client.disconnect();
      set({ sseClient: null });
    }
  },

  addChatBlock: (threadId, block) => {
    set((state) => ({
      chatBlocks: {
        ...state.chatBlocks,
        [threadId]: [...(state.chatBlocks[threadId] || []), block],
      },
    }));
  },

  setChatBlocks: (threadId, blocks) => {
    set((state) => ({
      chatBlocks: {
        ...state.chatBlocks,
        [threadId]: blocks,
      },
    }));
  },

  removeApproval: (threadId, approvalId) => {
    set((state) => ({
      approvals: {
        ...state.approvals,
        [threadId]: (state.approvals[threadId] || []).filter(
          (a) => a.id !== approvalId,
        ),
      },
    }));
  },

  removeUserInput: (threadId, inputId) => {
    set((state) => ({
      userInputs: {
        ...state.userInputs,
        [threadId]: (state.userInputs[threadId] || []).filter(
          (u) => u.id !== inputId,
        ),
      },
    }));
  },

  clearThread: (threadId) => {
    set((state) => {
      const newBlocks = { ...state.chatBlocks };
      delete newBlocks[threadId];
      const newApprovals = { ...state.approvals };
      delete newApprovals[threadId];
      const newInputs = { ...state.userInputs };
      delete newInputs[threadId];
      const newUsage = { ...state.usage };
      delete newUsage[threadId];
      return {
        chatBlocks: newBlocks,
        approvals: newApprovals,
        userInputs: newInputs,
        usage: newUsage,
      };
    });
  },
}));
