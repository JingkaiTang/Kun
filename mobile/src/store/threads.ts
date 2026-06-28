import { create } from 'zustand';
import type { ThreadSummary, ThreadDetail, TodoItem } from '../types/api';
import { listThreads, getThread, getThreadTodos } from '../api/threads';

interface ThreadsState {
  threads: ThreadSummary[];
  threadDetails: Record<string, ThreadDetail>;
  todos: Record<string, TodoItem[]>;
  loading: boolean;
  error: string | null;

  // Actions
  fetchThreads: () => Promise<void>;
  fetchThread: (id: string) => Promise<void>;
  fetchTodos: (threadId: string) => Promise<void>;
  updateTodos: (threadId: string, todos: TodoItem[]) => void;
  clearTodos: (threadId: string) => void;
}

export const useThreadsStore = create<ThreadsState>((set) => ({
  threads: [],
  threadDetails: {},
  todos: {},
  loading: false,
  error: null,

  fetchThreads: async () => {
    set({ loading: true, error: null });
    try {
      const threads = await listThreads();
      set({ threads, loading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load threads', loading: false });
    }
  },

  fetchThread: async (id: string) => {
    try {
      const detail = await getThread(id);
      set((state) => ({
        threadDetails: { ...state.threadDetails, [id]: detail },
      }));
    } catch (err: any) {
      console.error('Failed to fetch thread:', err);
    }
  },

  fetchTodos: async (threadId: string) => {
    try {
      const todoList = await getThreadTodos(threadId);
      set((state) => ({
        todos: { ...state.todos, [threadId]: todoList?.items ?? [] },
      }));
    } catch (err: any) {
      console.error('Failed to fetch todos:', err);
    }
  },

  updateTodos: (threadId: string, todos: TodoItem[]) => {
    set((state) => ({
      todos: { ...state.todos, [threadId]: todos },
    }));
  },

  clearTodos: (threadId: string) => {
    set((state) => {
      const newTodos = { ...state.todos };
      delete newTodos[threadId];
      return { todos: newTodos };
    });
  },
}));
