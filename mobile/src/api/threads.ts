import { apiFetch } from './client';
import type { ThreadSummary, ThreadDetail, TodoItem, ChatBlock } from '../types/api';

interface ListThreadsResponse {
  threads: ThreadSummary[];
}

// Kun API turn item types
interface KunTurnItem {
  id: string;
  turnId: string;
  threadId: string;
  role: string;
  kind: string;
  text?: string;
  toolName?: string;
  summary?: string;
  output?: unknown;
  isError?: boolean;
  createdAt: string;
}

interface KunTurn {
  id: string;
  threadId: string;
  status: string;
  prompt: string;
  items: KunTurnItem[];
  createdAt: string;
}

interface KunThreadDetail extends ThreadDetail {
  turns: KunTurn[];
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const response = await apiFetch<ListThreadsResponse>('/v1/threads');
  return response.threads;
}

function convertTurnItemsToChatBlocks(thread: KunThreadDetail): ChatBlock[] {
  const blocks: ChatBlock[] = [];

  for (const turn of thread.turns || []) {
    // Add user message
    if (turn.prompt) {
      blocks.push({
        id: `turn_${turn.id}_user`,
        kind: 'user_text',
        content: turn.prompt,
        timestamp: turn.createdAt,
      });
    }

    // Add turn items
    for (const item of turn.items || []) {
      if (item.kind === 'user_message' && item.text) {
        // Skip if same as turn prompt (avoid duplicates)
        if (item.text !== turn.prompt) {
          blocks.push({
            id: item.id,
            kind: 'user_text',
            content: item.text,
            timestamp: item.createdAt,
          });
        }
      } else if (item.kind === 'assistant_text' && item.text) {
        blocks.push({
          id: item.id,
          kind: 'assistant_text',
          content: item.text,
          timestamp: item.createdAt,
        });
      } else if (item.kind === 'tool_call') {
        blocks.push({
          id: item.id,
          kind: 'tool_call',
          content: item.summary || `Calling ${item.toolName}...`,
          toolName: item.toolName,
          timestamp: item.createdAt,
        });
      } else if (item.kind === 'tool_result') {
        const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output, null, 2);
        blocks.push({
          id: item.id,
          kind: 'tool_result',
          content: output || '',
          toolName: item.toolName,
          timestamp: item.createdAt,
        });
      }
    }
  }

  return blocks;
}

export async function getThread(id: string): Promise<ThreadDetail & { chatBlocks?: ChatBlock[] }> {
  const thread = await apiFetch<KunThreadDetail>(`/v1/threads/${id}`);
  const chatBlocks = convertTurnItemsToChatBlocks(thread);
  return { ...thread, chatBlocks };
}

export async function getThreadTodos(id: string): Promise<TodoItem[]> {
  return apiFetch<TodoItem[]>(`/v1/threads/${id}/todos`);
}
