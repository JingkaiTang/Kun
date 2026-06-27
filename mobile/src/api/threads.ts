import { apiFetch } from './client';
import type { ThreadSummary, ThreadDetail, TodoItem } from '../types/api';

interface ListThreadsResponse {
  threads: ThreadSummary[];
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const response = await apiFetch<ListThreadsResponse>('/v1/threads');
  return response.threads;
}

export async function getThread(id: string): Promise<ThreadDetail> {
  return apiFetch<ThreadDetail>(`/v1/threads/${id}`);
}

export async function getThreadTodos(id: string): Promise<TodoItem[]> {
  return apiFetch<TodoItem[]>(`/v1/threads/${id}/todos`);
}
