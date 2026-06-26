import { apiFetch } from './client';
import type { ThreadSummary, ThreadDetail, TodoItem } from '../types/api';

export async function listThreads(): Promise<ThreadSummary[]> {
  return apiFetch<ThreadSummary[]>('/v1/threads');
}

export async function getThread(id: string): Promise<ThreadDetail> {
  return apiFetch<ThreadDetail>(`/v1/threads/${id}`);
}

export async function getThreadTodos(id: string): Promise<TodoItem[]> {
  return apiFetch<TodoItem[]>(`/v1/threads/${id}/todos`);
}
