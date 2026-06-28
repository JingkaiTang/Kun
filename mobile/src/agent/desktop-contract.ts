/**
 * Desktop-local DTO types — mobile-side mirror of the desktop-local section
 * of `src/shared/mobile-api-types.ts`. These describe the responses served
 * by the Mobile Gateway itself at `/mobile/v1/desktop/...` (never proxied
 * to the Kun runtime).
 *
 * The mobile app uses pure types (no zod) because it validates structurally
 * against the gateway, exactly like `kun-contract.ts`.
 */

export type DesktopScheduleKind = 'manual' | 'interval' | 'daily' | 'at'
export type DesktopScheduleTaskStatus = 'idle' | 'queued' | 'running' | 'success' | 'error'
export type DesktopScheduleRunMode = 'agent' | 'plan'
export type DesktopScheduleReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'

export type DesktopScheduleTaskSchedule = {
  kind: DesktopScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

/**
 * Mirror of `ScheduledTaskV1` from `src/shared/app-settings-types.ts`.
 * The mobile app treats this as an opaque server-owned record — it only
 * mutates `enabled` and `schedule` via the PATCH endpoint.
 */
export type DesktopScheduleTask = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  clawChannelId: string
  providerId?: string
  model: string
  reasoningEffort: DesktopScheduleReasoningEffort
  mode: DesktopScheduleRunMode
  priority?: number
  dependsOn?: string[]
  useWorktree?: boolean
  schedule: DesktopScheduleTaskSchedule
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: DesktopScheduleTaskStatus
  lastMessage: string
  lastThreadId: string
}

export type DesktopScheduleRunResult =
  | { ok: true; threadId: string; turnId?: string; queued?: boolean; message?: string }
  | { ok: false; message: string }

export type DesktopScheduleRuntimeStatus = {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  powerSaveBlockerActive: boolean
}

/** Provider profile with secrets stripped — shown in mobile Settings UI. */
export type DesktopProviderSummary = {
  id: string
  name: string
  models: string[]
}

/**
 * Mobile-safe settings snapshot. All API keys, runtime tokens, internal
 * schedule secrets, and provider base URLs are stripped before leaving
 * the desktop process.
 */
export type DesktopSettingsSnapshot = {
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  model: string
  providerId: string
  schedule: {
    enabled: boolean
    model: string
    mode: DesktopScheduleRunMode
    providerId: string
    taskCount: number
  }
  providers: DesktopProviderSummary[]
  mobile: {
    gatewayEnabled: boolean
    sessionCount: number
  }
}

/** Session row without the bearer token — safe to render on any device. */
export type DesktopSessionSummary = {
  id: string
  name: string
  createdAt: string
  /** True on the session whose token matches the current request. */
  current?: boolean
}

/** PATCH body accepted by `PATCH /v1/desktop/schedule/tasks/{id}`. */
export type DesktopScheduleTaskPatch = {
  enabled?: boolean
  schedule?: Partial<DesktopScheduleTaskSchedule>
}
