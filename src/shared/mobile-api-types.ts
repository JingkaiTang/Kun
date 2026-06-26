/**
 * Shared DTOs consumed by both the Mobile Gateway (desktop main process)
 * and the Kun Mobile app (React Native / Expo).
 *
 * These types describe the subset of the Kun HTTP API that the mobile
 * companion app accesses through the Mobile Gateway proxy. They are
 * intentionally minimal — the mobile app is a thin API consumer, not a
 * full agent runtime.
 */

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
