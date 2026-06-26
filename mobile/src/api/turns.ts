import { apiFetch } from './client';

export async function sendMessage(threadId: string, text: string): Promise<void> {
  await apiFetch<void>(`/v1/threads/${threadId}/turns`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}
