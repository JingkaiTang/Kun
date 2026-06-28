/**
 * Desktop-gateway client — talks to the Mobile Gateway's desktop-local
 * routes (`/mobile/v1/desktop/...`), which are served by the gateway itself
 * and never proxied to the Kun runtime. This is a separate client from
 * `KunRuntimeClient` (which implements AgentProvider against Kun's
 * `/mobile/v1/threads/...` surface) because the desktop-local routes expose
 * a completely different concern: settings snapshot, schedule tasks, and
 * the mobile-session list.
 *
 * Contract mirror of `src/main/mobile-gateway.ts` handleDesktopLocalRequest.
 */

import { notifyAuthError, notifyNetworkError } from '../api/client'
import type {
  DesktopScheduleRunResult,
  DesktopScheduleRuntimeStatus,
  DesktopScheduleTask,
  DesktopScheduleTaskPatch,
  DesktopSessionSummary,
  DesktopSettingsSnapshot
} from './desktop-contract'

export interface DesktopClientConfig {
  baseUrl: string
  token: string
  /** Optional fetch impl override (testing). */
  fetchImpl?: typeof fetch
}

export class DesktopGatewayClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(config: DesktopClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.token = config.token
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/mobile/v1/desktop${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined)
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, headers })
    } catch (err) {
      notifyNetworkError()
      throw err
    }
    if (response.status === 401) {
      notifyAuthError()
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const text = await response.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSettings(): Promise<DesktopSettingsSnapshot> {
    return this.request<DesktopSettingsSnapshot>('/settings')
  }

  // -------------------------------------------------------------------------
  // Schedule tasks
  // -------------------------------------------------------------------------

  async listScheduleTasks(): Promise<DesktopScheduleTask[]> {
    const data = await this.request<{ tasks: DesktopScheduleTask[] }>('/schedule/tasks')
    return data.tasks ?? []
  }

  async getScheduleTask(taskId: string): Promise<DesktopScheduleTask | null> {
    try {
      const data = await this.request<{ task: DesktopScheduleTask }>(
        `/schedule/tasks/${encodeURIComponent(taskId)}`
      )
      return data.task
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('HTTP 404')) return null
      throw err
    }
  }

  async runScheduleTask(taskId: string): Promise<DesktopScheduleRunResult> {
    const data = await this.request<{ result: DesktopScheduleRunResult }>(
      `/schedule/tasks/${encodeURIComponent(taskId)}/run`,
      { method: 'POST' }
    )
    return data.result
  }

  async updateScheduleTask(
    taskId: string,
    patch: DesktopScheduleTaskPatch
  ): Promise<DesktopScheduleTask> {
    const data = await this.request<{ task: DesktopScheduleTask }>(
      `/schedule/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    )
    return data.task
  }

  async getScheduleStatus(): Promise<DesktopScheduleRuntimeStatus> {
    const data = await this.request<{ status: DesktopScheduleRuntimeStatus }>('/schedule/status')
    return data.status
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async listSessions(): Promise<DesktopSessionSummary[]> {
    const data = await this.request<{ sessions: DesktopSessionSummary[] }>('/sessions')
    return data.sessions ?? []
  }
}
