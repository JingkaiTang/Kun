import { apiFetch } from './client';

export async function submitUserInput(
  inputId: string,
  answers: string
): Promise<void> {
  await apiFetch<void>(`/v1/user-inputs/${inputId}`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}
