/**
 * Desktop snapshot store — manages the mobile-side view of desktop-owned
 * state served by the Mobile Gateway's `/v1/desktop/...` routes:
 *  - settings snapshot (locale/theme/model/provider/schedule summary)
 *  - scheduled tasks list + runtime status (running/queued ids)
 *  - mobile sessions list (this-device flag, no tokens)
 *
 * Aligned with the desktop's settings/schedule panels in spirit but trimmed
 * to a mobile-safe read-mostly surface:
 *  - reads are explicit actions (`refreshSettings`, `refreshSchedule`, etc.)
 *  - writes are limited to what mobile should touch: toggle a task's enabled
 *    flag, change its schedule kind/time, or trigger a manual run
 *  - no provider/model/workspace editing — those stay on the desktop editor
 *
 * The store is a thin wrapper over `DesktopGatewayClient`; it owns no SSE
 * subscription. Schedule status is polled on demand (the UI calls
 * `refreshScheduleStatus` after a run or on focus).
 */

import { create } from 'zustand'
import { DesktopGatewayClient } from '../agent/desktop-client'
import { useConnectionStore } from './connection'
import type {
  DesktopScheduleRunResult,
  DesktopScheduleRuntimeStatus,
  DesktopScheduleTask,
  DesktopScheduleTaskPatch,
  DesktopSessionSummary,
  DesktopSettingsSnapshot
} from '../agent/desktop-contract'

export interface DesktopState {
  settings: DesktopSettingsSnapshot | null
  settingsLoading: boolean

  scheduleTasks: DesktopScheduleTask[]
  scheduleTasksLoading: boolean
  scheduleStatus: DesktopScheduleRuntimeStatus | null
  scheduleStatusLoading: boolean

  sessions: DesktopSessionSummary[]
  sessionsLoading: boolean

  error: string | null
  lastRunResult: { taskId: string; result: DesktopScheduleRunResult } | null

  // Actions
  refreshSettings: () => Promise<boolean>
  refreshSchedule: () => Promise<boolean>
  refreshScheduleStatus: () => Promise<boolean>
  refreshSessions: () => Promise<boolean>
  refreshAll: () => Promise<void>

  runTask: (taskId: string) => Promise<DesktopScheduleRunResult | null>
  toggleTaskEnabled: (taskId: string, enabled: boolean) => Promise<boolean>
  patchTaskSchedule: (
    taskId: string,
    patch: DesktopScheduleTaskPatch['schedule']
  ) => Promise<boolean>

  clearError: () => void
  reset: () => void
}

let activeClient: DesktopGatewayClient | null = null

function getClient(): DesktopGatewayClient {
  if (activeClient) return activeClient
  const { baseUrl, token } = useConnectionStore.getState()
  if (!baseUrl || !token) {
    throw new Error('Not connected to a Kun desktop')
  }
  activeClient = new DesktopGatewayClient({ baseUrl, token })
  return activeClient
}

function resetClient(): void {
  activeClient = null
}

// Reset the client whenever the connection changes — mirrors chat-store.
let lastConnectionKey: string | null = null
useConnectionStore.subscribe((state) => {
  const key = state.status === 'connected' && state.baseUrl && state.token
    ? `${state.baseUrl}::${state.token}`
    : null
  if (key !== lastConnectionKey) {
    lastConnectionKey = key
    resetClient()
    if (key === null) {
      useDesktopStore.getState().reset()
    }
  }
})

export const useDesktopStore = create<DesktopState>((set, get) => ({
  settings: null,
  settingsLoading: false,
  scheduleTasks: [],
  scheduleTasksLoading: false,
  scheduleStatus: null,
  scheduleStatusLoading: false,
  sessions: [],
  sessionsLoading: false,
  error: null,
  lastRunResult: null,

  refreshSettings: async () => {
    set({ settingsLoading: true })
    try {
      const client = getClient()
      const settings = await client.getSettings()
      set({ settings, settingsLoading: false, error: null })
      return true
    } catch (err) {
      set({
        settingsLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load settings'
      })
      return false
    }
  },

  refreshSchedule: async () => {
    set({ scheduleTasksLoading: true })
    try {
      const client = getClient()
      const tasks = await client.listScheduleTasks()
      set({ scheduleTasks: tasks, scheduleTasksLoading: false, error: null })
      return true
    } catch (err) {
      set({
        scheduleTasksLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load schedule tasks'
      })
      return false
    }
  },

  refreshScheduleStatus: async () => {
    set({ scheduleStatusLoading: true })
    try {
      const client = getClient()
      const status = await client.getScheduleStatus()
      set({ scheduleStatus: status, scheduleStatusLoading: false, error: null })
      return true
    } catch (err) {
      set({
        scheduleStatusLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load schedule status'
      })
      return false
    }
  },

  refreshSessions: async () => {
    set({ sessionsLoading: true })
    try {
      const client = getClient()
      const sessions = await client.listSessions()
      set({ sessions, sessionsLoading: false, error: null })
      return true
    } catch (err) {
      set({
        sessionsLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load sessions'
      })
      return false
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().refreshSettings(),
      get().refreshSchedule(),
      get().refreshScheduleStatus(),
      get().refreshSessions()
    ])
  },

  runTask: async (taskId) => {
    try {
      const client = getClient()
      const result = await client.runScheduleTask(taskId)
      set({ lastRunResult: { taskId, result }, error: null })
      // Refresh status so the UI reflects running/queued ids immediately.
      void get().refreshScheduleStatus()
      // Also refresh the task itself so lastStatus/lastRunAt update.
      void get().refreshSchedule()
      return result
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to run task' })
      return null
    }
  },

  toggleTaskEnabled: async (taskId, enabled) => {
    try {
      const client = getClient()
      const updated = await client.updateScheduleTask(taskId, { enabled })
      set((s) => ({
        scheduleTasks: s.scheduleTasks.map((t) => (t.id === taskId ? updated : t)),
        error: null
      }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update task' })
      return false
    }
  },

  patchTaskSchedule: async (taskId, patch) => {
    try {
      const client = getClient()
      const updated = await client.updateScheduleTask(taskId, { schedule: patch })
      set((s) => ({
        scheduleTasks: s.scheduleTasks.map((t) => (t.id === taskId ? updated : t)),
        error: null
      }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update schedule' })
      return false
    }
  },

  clearError: () => set({ error: null }),

  reset: () => set({
    settings: null,
    scheduleTasks: [],
    scheduleStatus: null,
    sessions: [],
    error: null,
    lastRunResult: null,
    settingsLoading: false,
    scheduleTasksLoading: false,
    scheduleStatusLoading: false,
    sessionsLoading: false
  })
}))
