// Mobile-specific types for Kun app

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

export interface ChatBlock {
  id: string;
  kind: 'user_text' | 'assistant_text' | 'tool_call' | 'tool_result' | 'error' | 'system';
  content: string;
  toolName?: string;
  timestamp: string;
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
