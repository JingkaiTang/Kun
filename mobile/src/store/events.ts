import { create } from 'zustand';
import type {
  ChatBlock,
  ApprovalBlock,
  UserInputBlock,
  ToolBlock,
  SSEEvent,
  TodoItem,
  UsageInfo,
} from '../types/api';
import { SSEClient } from '../api/sse';
import { useThreadsStore } from './threads';

interface EventsState {
  chatBlocks: Record<string, ChatBlock[]>;
  usage: Record<string, UsageInfo>;
  sseClient: SSEClient | null;

  connectSSE: (baseUrl: string, token: string, threadId: string) => void;
  disconnectSSE: () => void;
  addChatBlock: (threadId: string, block: ChatBlock) => void;
  setChatBlocks: (threadId: string, blocks: ChatBlock[]) => void;
  updateBlockStatus: (threadId: string, blockId: string, status: string) => void;
  resolveApproval: (threadId: string, approvalId: string, status: 'allowed' | 'denied' | 'error', errorMessage?: string) => void;
  resolveUserInput: (threadId: string, requestId: string, answer: string) => void;
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
              text: 'Turn started...',
              createdAt: new Date().toISOString(),
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
        if (lastBlock && lastBlock.kind === 'assistant') {
          blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + text };
          return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
        }
        return {
          chatBlocks: {
            ...state.chatBlocks,
            [threadId]: [
              ...blocks,
              {
                id: nextBlockId(),
                kind: 'assistant' as const,
                text,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        };
      });
      break;
    }

    case 'reasoning_text': {
      const text = data.text || data.content || data.delta || '';
      if (!text) break;
      set((state: EventsState) => {
        const blocks = [...(state.chatBlocks[threadId] || [])];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.kind === 'reasoning') {
          blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + text };
          return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
        }
        return {
          chatBlocks: {
            ...state.chatBlocks,
            [threadId]: [
              ...blocks,
              {
                id: nextBlockId(),
                kind: 'reasoning' as const,
                text,
                createdAt: new Date().toISOString(),
              },
            ],
          },
        };
      });
      break;
    }

    case 'tool_call_ready': {
      const toolName = data.name || data.tool || 'unknown';
      const toolBlock: ToolBlock = {
        id: nextBlockId(),
        kind: 'tool',
        summary: data.summary || `Running ${toolName}...`,
        status: 'running',
        toolName,
        detail: data.detail,
        createdAt: new Date().toISOString(),
      };
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            toolBlock,
          ],
        },
      }));
      break;
    }

    case 'tool_call_finished': {
      const toolName = data.name || data.tool || 'unknown';
      set((state: EventsState) => {
        const blocks = [...(state.chatBlocks[threadId] || [])];
        // Find the last running tool block and update it
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i];
          if (block.kind === 'tool' && block.status === 'running') {
            blocks[i] = {
              ...block,
              status: data.error ? 'error' : 'success',
              summary: data.summary || block.summary,
              detail: data.detail || data.result || block.detail,
            };
            break;
          }
        }
        return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
      });
      break;
    }

    case 'approval_requested': {
      const approvalBlock: ApprovalBlock = {
        id: nextBlockId(),
        kind: 'approval',
        approvalId: data.id || data.approvalId || nextBlockId(),
        summary: data.summary || data.message || 'Approval requested',
        toolName: data.toolName || data.tool,
        detail: data.detail || data.description,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            approvalBlock,
          ],
        },
      }));
      break;
    }

    case 'user_input_requested': {
      const inputBlock: UserInputBlock = {
        id: nextBlockId(),
        kind: 'user_input',
        requestId: data.id || data.inputId || nextBlockId(),
        prompt: data.prompt || data.message || 'Input requested',
        options: data.options,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      set((state: EventsState) => ({
        chatBlocks: {
          ...state.chatBlocks,
          [threadId]: [
            ...(state.chatBlocks[threadId] || []),
            inputBlock,
          ],
        },
      }));
      break;
    }

    case 'user_input_resolved': {
      const requestId = data.id || data.inputId;
      if (requestId) {
        set((state: EventsState) => {
          const blocks = [...(state.chatBlocks[threadId] || [])];
          for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i];
            if (block.kind === 'user_input' && block.requestId === requestId) {
              blocks[i] = { ...block, status: 'submitted' };
              break;
            }
          }
          return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
        });
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
              text: 'Turn completed',
              createdAt: new Date().toISOString(),
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
              text: data.error || data.message || 'Turn failed',
              createdAt: new Date().toISOString(),
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
              text: data.message || data.error || 'An error occurred',
              createdAt: new Date().toISOString(),
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

  updateBlockStatus: (threadId, blockId, status) => {
    set((state) => {
      const blocks = [...(state.chatBlocks[threadId] || [])];
      const index = blocks.findIndex((b) => b.id === blockId);
      if (index !== -1) {
        blocks[index] = { ...blocks[index], status } as any;
      }
      return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
    });
  },

  resolveApproval: (threadId, approvalId, status, errorMessage) => {
    set((state) => {
      const blocks = [...(state.chatBlocks[threadId] || [])];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block.kind === 'approval' && block.approvalId === approvalId) {
          blocks[i] = { ...block, status, errorMessage };
          break;
        }
      }
      return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
    });
  },

  resolveUserInput: (threadId, requestId, answer) => {
    set((state) => {
      const blocks = [...(state.chatBlocks[threadId] || [])];
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block.kind === 'user_input' && block.requestId === requestId) {
          blocks[i] = { ...block, status: 'submitted', answer };
          break;
        }
      }
      return { chatBlocks: { ...state.chatBlocks, [threadId]: blocks } };
    });
  },

  clearThread: (threadId) => {
    set((state) => {
      const newBlocks = { ...state.chatBlocks };
      delete newBlocks[threadId];
      const newUsage = { ...state.usage };
      delete newUsage[threadId];
      return {
        chatBlocks: newBlocks,
        usage: newUsage,
      };
    });
  },
}));
