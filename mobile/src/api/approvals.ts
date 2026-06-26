import { apiFetch } from './client';

export async function submitApproval(
  approvalId: string,
  decision: 'allow' | 'deny'
): Promise<void> {
  await apiFetch<void>(`/v1/approvals/${approvalId}`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}
