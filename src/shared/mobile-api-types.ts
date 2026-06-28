/**
 * Shared DTOs consumed by both the Mobile Gateway (desktop main process)
 * and the Kun Mobile app (React Native / Expo).
 *
 * These types describe two surfaces:
 *  - Kun HTTP API routes proxied through the gateway (`/mobile/v1/...`)
 *  - Desktop-local routes served by the gateway itself (`/mobile/v1/desktop/...`)
 *
 * They are intentionally minimal — the mobile app is a thin API consumer,
 * not a full agent runtime.
 */

import type {
  ScheduleRuntimeStatus,
  ScheduledTaskV1,
  ScheduleRunResult
} from './app-settings-types'

// ---------------------------------------------------------------------------
// Session (auth)
// ---------------------------------------------------------------------------

export interface MobileSessionV1 {
  /** Stable identifier — `crypto.randomUUID()`. */
  id: string
  /** Human-readable label shown in Settings, e.g. "iPhone 15". */
  name: string
  /** Bearer token sent by the mobile app on every request. */
  token: string
  /** ISO 8601 timestamp of when this session was created. */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface ThreadDTO {
  id: string
  title: string
  workspace: string
  model: string
  mode: 'agent' | 'plan'
  status: 'running' | 'idle' | 'completed' | 'failed' | 'archived'
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Todo
// ---------------------------------------------------------------------------

export interface TodoDTO {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface ApprovalDTO {
  id: string
  summary: string
  toolName: string
  status: 'pending' | 'approved' | 'denied'
}

// ---------------------------------------------------------------------------
// Desktop-local routes (`/mobile/v1/desktop/...`)
//
// These routes are served by the Mobile Gateway itself — they never reach
// the Kun runtime. They expose a mobile-safe subset of desktop settings,
// schedule tasks/status, and the mobile-session list (without secrets).
// ---------------------------------------------------------------------------

/** Provider profile with secrets stripped — shown in mobile Settings UI. */
export interface MobileProviderSummaryV1 {
  id: string
  name: string
  models: string[]
}

/**
 * Mobile-safe settings snapshot. All API keys, runtime tokens, internal
 * schedule secrets, and provider base URLs are stripped before leaving
 * the desktop process.
 */
export interface MobileSettingsSnapshotV1 {
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  /** Active Kun runtime model (resolved from agents.kun). */
  model: string
  /** Active Kun runtime provider id (resolved from agents.kun). */
  providerId: string
  schedule: {
    enabled: boolean
    model: string
    mode: 'agent' | 'plan'
    providerId: string
    /** Number of configured scheduled tasks (the tasks themselves come via /schedule/tasks). */
    taskCount: number
  }
  providers: MobileProviderSummaryV1[]
  mobile: {
    gatewayEnabled: boolean
    sessionCount: number
  }
}

/** Session row without the bearer token — safe to render on any device. */
export interface MobileSessionSummaryV1 {
  id: string
  name: string
  createdAt: string
  /**
   * Set to `true` on the session whose token matches the current request's
   * bearer token. Only populated by the `GET /v1/desktop/sessions` endpoint
   * so the mobile UI can highlight "this device". Omitted elsewhere.
   */
  current?: boolean
}

// Re-export the Kun-side types that are passed through verbatim by the
// desktop-local routes. Mobile consumers import these from this module so
// they don't need to know about the larger app-settings-types surface.
export type MobileScheduledTaskV1 = ScheduledTaskV1
export type MobileScheduleRuntimeStatusV1 = ScheduleRuntimeStatus
export type MobileScheduleRunResultV1 = ScheduleRunResult

/** PATCH body accepted by `PATCH /v1/desktop/schedule/tasks/{id}`. */
export interface MobileScheduleTaskPatchV1 {
  enabled?: boolean
  schedule?: Partial<ScheduledTaskV1['schedule']>
}
