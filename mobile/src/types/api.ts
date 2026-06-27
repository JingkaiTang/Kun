// Mobile-specific types for Kun app
// Aligned with desktop agent/types.ts ChatBlock structure

export interface ThreadSummary {
  id: string;
  title: string;
  model?: string;
  status: 'active' | 'completed' | 'failed' | 'idle';
  createdAt: string;
  updatedAt: string;
  turnCount?: number;
  todoCount?: number;
  completedTodoCount?: number;
}

export interface ThreadDetail extends ThreadSummary {
  turns?: TurnSummary[];
  chatBlocks?: ChatBlock[];
}

export interface TurnSummary {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  createdAt: string;
}

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  order: number;
}

// ---- ChatBlock types (aligned with desktop) ----

export type ToolBlock = {
  kind: 'tool';
  id: string;
  turnId?: string;
  createdAt?: string;
  summary: string;
  status: 'running' | 'success' | 'error';
  toolName?: string;
  detail?: string;
  filePath?: string;
  meta?: Record<string, unknown>;
};

export type ApprovalBlock = {
  kind: 'approval';
  id: string;
  createdAt?: string;
  approvalId: string;
  summary: string;
  toolName?: string;
  detail?: string;
  status: 'pending' | 'submitting' | 'allowed' | 'denied' | 'error';
  errorMessage?: string;
};

export type UserInputBlock = {
  kind: 'user_input';
  id: string;
  createdAt?: string;
  requestId: string;
  prompt: string;
  options?: string[];
  status: 'pending' | 'submitted' | 'cancelled' | 'error';
  answer?: string;
  errorMessage?: string;
};

export type ChatBlock =
  | {
      kind: 'user';
      id: string;
      turnId?: string;
      createdAt?: string;
      text: string;
      modelLabel?: string;
    }
  | {
      kind: 'assistant';
      id: string;
      turnId?: string;
      createdAt?: string;
      text: string;
    }
  | {
      kind: 'reasoning';
      id: string;
      createdAt?: string;
      text: string;
    }
  | ToolBlock
  | ApprovalBlock
  | UserInputBlock
  | {
      kind: 'system';
      id: string;
      createdAt?: string;
      text: string;
      code?: string;
      detail?: string;
    }
  | {
      kind: 'error';
      id: string;
      createdAt?: string;
      text: string;
    }
  | {
      kind: 'compaction';
      id: string;
      createdAt?: string;
      summary: string;
      status: 'running' | 'success' | 'error';
      detail?: string;
    };

// ---- Legacy types (kept for API compatibility) ----

export interface Approval {
  id: string;
  threadId: string;
  turnId: string;
  kind: string;
  summary: string;
  detail?: string;
  createdAt: string;
}

export interface UserInputRequest {
  id: string;
  threadId: string;
  turnId: string;
  prompt: string;
  options?: string[];
  createdAt: string;
}

export interface SSEEvent {
  kind: string;
  data: any;
  threadId?: string;
  turnId?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  turns: number;
  cost?: number;
}

// ---- Turn grouping ----

export interface Turn {
  id: string;
  userBlock?: ChatBlock & { kind: 'user' };
  blocks: ChatBlock[];
}
