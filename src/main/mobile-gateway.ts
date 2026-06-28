import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AppSettingsV1, ScheduledTaskV1, ScheduleRunResult, ScheduleRuntimeStatus } from '../shared/app-settings-types'
import type {
  MobileSessionSummaryV1,
  MobileSessionV1,
  MobileSettingsSnapshotV1
} from '../shared/mobile-api-types'
import { validateToken } from './mobile-session'
import type { ScheduleRuntime } from './schedule-runtime'

// ---------------------------------------------------------------------------
// Port allocation (self-contained – same pattern as kun-process.ts)
// ---------------------------------------------------------------------------

function canBindTcpPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const server = createServer()
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      server.removeAllListeners('listening')
      server.close(() => resolve(available))
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen({ port, host, exclusive: true }, () => settle(true))
  })
}

async function allocateTcpPort(host: string, startPort = 19900): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await canBindTcpPort(port, host)) return port
  }
  throw new Error('No available TCP port found')
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

interface WhitelistEntry {
  method: string
  pattern: string
}

const WHITELIST: WhitelistEntry[] = [
  { method: 'GET',    pattern: '/health' },
  { method: 'GET',    pattern: '/v1/threads' },
  { method: 'GET',    pattern: '/v1/threads/{id}' },
  { method: 'GET',    pattern: '/v1/threads/{id}/todos' },
  { method: 'POST',   pattern: '/v1/threads/{id}/todos' },
  { method: 'DELETE', pattern: '/v1/threads/{id}/todos' },
  { method: 'GET',    pattern: '/v1/threads/{id}/events' },
  { method: 'POST',   pattern: '/v1/threads/{id}/turns' },
  { method: 'POST',   pattern: '/v1/threads/{id}/turns/{turn}/interrupt' },
  { method: 'POST',   pattern: '/v1/threads/{id}/turns/{turn}/steer' },
  { method: 'POST',   pattern: '/v1/approvals/{id}' },
  { method: 'POST',   pattern: '/v1/user-inputs/{id}' },
  { method: 'GET',    pattern: '/v1/usage' },
]

function matchWhitelist(method: string | undefined, path: string): boolean {
  if (!method) return false
  const segments = path.split('/').filter(Boolean)
  return WHITELIST.some((entry) => {
    if (entry.method !== method.toUpperCase()) return false
    const entrySegments = entry.pattern.split('/').filter(Boolean)
    if (entrySegments.length !== segments.length) return false
    return entrySegments.every((es, i) =>
      es.startsWith('{') && es.endsWith('}') ? true : es === segments[i]
    )
  })
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

/**
 * Optional desktop-local capabilities the gateway can call into when serving
 * `/v1/desktop/...` routes. All callbacks are owned by the desktop main
 * process (schedule runtime + settings store); the gateway stays a thin
 * HTTP layer. Every callback is optional so unit tests can construct a
 * gateway without a real schedule runtime.
 */
export interface MobileGatewayDeps {
  listScheduleTasks?: () => Promise<ScheduledTaskV1[]>
  runScheduleTask?: (taskId: string) => Promise<ScheduleRunResult>
  updateScheduleTask?: (taskId: string, patch: Partial<ScheduledTaskV1>) => Promise<ScheduledTaskV1 | null>
  getScheduleStatus?: () => Promise<ScheduleRuntimeStatus>
}

/**
 * Wire a `ScheduleRuntime` (desktop main process) into the gateway deps
 * shape. When the runtime is null (e.g. not yet initialized), every call
 * degrades gracefully: reads return empty/idle, writes return a soft
 * failure, and the gateway still responds — so the mobile UI can render
 * an "unavailable" state instead of hanging on a 501.
 */
export function buildMobileGatewayDeps(
  getScheduleRuntime: () => ScheduleRuntime | null
): MobileGatewayDeps {
  return {
    listScheduleTasks: async () => {
      const rt = getScheduleRuntime()
      return rt ? rt.listTasks() : []
    },
    runScheduleTask: async (taskId) => {
      const rt = getScheduleRuntime()
      if (!rt) return { ok: false, message: 'Schedule runtime is not initialized.' }
      return rt.runTask(taskId)
    },
    updateScheduleTask: async (taskId, patch) => {
      const rt = getScheduleRuntime()
      if (!rt) return null
      return rt.updateTaskById(taskId, patch)
    },
    getScheduleStatus: async () => {
      const rt = getScheduleRuntime()
      if (!rt) {
        return {
          internalServerRunning: false,
          internalUrl: '',
          runningTaskIds: [],
          queuedTaskIds: [],
          powerSaveBlockerActive: false
        }
      }
      return rt.status()
    }
  }
}

/**
 * Build the mobile-safe settings snapshot. Strips every secret the desktop
 * process ever holds: API keys, runtime tokens, provider base URLs, and the
 * schedule internal secret. The mobile app only learns what it needs to
 * render the Settings UI.
 */
export function buildMobileSettingsSnapshot(settings: AppSettingsV1): MobileSettingsSnapshotV1 {
  const kun = settings.agents.kun
  return {
    locale: settings.locale,
    theme: settings.theme,
    model: kun.model,
    providerId: kun.providerId,
    schedule: {
      enabled: settings.schedule.enabled,
      model: settings.schedule.model,
      mode: settings.schedule.mode,
      providerId: settings.schedule.providerId ?? '',
      taskCount: settings.schedule.tasks.length
    },
    providers: settings.provider.providers.map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models
    })),
    mobile: {
      gatewayEnabled: settings.mobile.gatewayEnabled,
      sessionCount: settings.mobile.sessions.length
    }
  }
}

function toSessionSummary(session: MobileSessionV1): MobileSessionSummaryV1 {
  return { id: session.id, name: session.name, createdAt: session.createdAt }
}

export class MobileGateway {
  private server: Server | null = null
  private port = 0
  private kunPort = 0
  private sessions: MobileSessionV1[]
  private readonly settingsStore: { load(): Promise<AppSettingsV1> }
  private readonly log: (msg: string) => void
  private readonly deps: MobileGatewayDeps

  constructor(
    settingsStore: { load(): Promise<AppSettingsV1> },
    sessions: MobileSessionV1[],
    log: (msg: string) => void,
    deps: MobileGatewayDeps = {}
  ) {
    this.settingsStore = settingsStore
    this.sessions = sessions
    this.log = log
    this.deps = deps
  }

  get activePort(): number {
    return this.port
  }

  /**
   * Start the Gateway.
   * 1. Reads Kun runtime port from settings.
   * 2. Probes Kun /health — refuses to start if Kun is not reachable.
   * 3. Allocates a free port on 0.0.0.0 and starts the HTTP proxy.
   */
  async start(): Promise<number> {
    if (this.server) return this.port

    const settings = await this.settingsStore.load()
    this.kunPort = settings.agents?.kun?.port ?? 18899

    // Probe Kun health
    const kunAlive = await this.probeKunHealth()
    if (!kunAlive) {
      throw new Error(
        `Kun runtime is not reachable at 127.0.0.1:${this.kunPort}. ` +
        `Start Kun before enabling mobile connectivity.`
      )
    }

    this.port = await allocateTcpPort('0.0.0.0')

    this.server = createServer((req, res) => this.handleRequest(req, res))
    this.server.on('error', (err) => {
      this.log(`[mobile-gateway] server error: ${err.message}`)
    })

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, '0.0.0.0', resolve)
    })

    this.log(`[mobile-gateway] started on 0.0.0.0:${this.port}, proxying to 127.0.0.1:${this.kunPort}`)
    return this.port
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err)
        else {
          this.server = null
          this.port = 0
          this.log('[mobile-gateway] stopped')
          resolve()
        }
      })
    })
  }

  /** Refresh the in-memory session list (called when token is refreshed/revoked). */
  updateSessions(sessions: MobileSessionV1[]): void {
    this.sessions = sessions
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async probeKunHealth(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.kunPort}/health`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const start = Date.now()

    // CORS headers for all responses
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    // 1. Auth (allow /health without token)
    const rawPath = req.url ?? '/'
    const isHealth = rawPath.replace(/^\/mobile/, '') === '/health' || rawPath === '/health'
    if (!isHealth) {
      const authHeader = req.headers.authorization ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      if (!validateToken(token, this.sessions)) {
        res.writeHead(401, { 'content-type': 'text/plain', ...corsHeaders })
        res.end('Unauthorized')
        this.log(`[mobile-gateway] ${req.method} ${req.url} → 401 (${Date.now() - start}ms)`)
        return
      }
    }

    // 2. Handle health check directly (no proxy to Kun API)
    if (isHealth) {
      res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ status: 'ok', service: 'mobile-gateway' }))
      this.log(`[mobile-gateway] ${req.method} ${req.url} → 200 (${Date.now() - start}ms)`)
      return
    }

    // 3. Strip /mobile prefix
    if (!rawPath.startsWith('/mobile')) {
      res.writeHead(404, { 'content-type': 'text/plain', ...corsHeaders })
      res.end('Not Found')
      return
    }
    const targetPath = rawPath.slice('/mobile'.length) || '/'

    // 4. Desktop-local routes — served by the gateway itself, never proxied
    //    to Kun. The namespace `/v1/desktop/...` is intentionally disjoint
    //    from the Kun whitelist so neither side can shadow the other.
    if (targetPath.startsWith('/v1/desktop/') || targetPath === '/v1/desktop') {
      void this.handleDesktopLocalRequest(req, res, targetPath, corsHeaders, start)
      return
    }

    // 5. Whitelist check
    if (!matchWhitelist(req.method, targetPath)) {
      res.writeHead(404, { 'content-type': 'text/plain', ...corsHeaders })
      res.end('Not Found')
      this.log(`[mobile-gateway] ${req.method} ${targetPath} → 404 (whitelist) ${Date.now() - start}ms`)
      return
    }

    // 6. Proxy to Kun API — remove hop-by-hop and upstream-incorrect headers
    const { authorization: _auth, host: _host, ...forwardHeaders } = req.headers
    const options = {
      host: '127.0.0.1',
      port: this.kunPort,
      path: targetPath,
      method: req.method,
      headers: forwardHeaders
    }

    const proxyReq = httpRequest(options, (proxyRes) => {
      // Merge CORS headers with upstream response headers
      const mergedHeaders = { ...proxyRes.headers, ...corsHeaders }
      res.writeHead(proxyRes.statusCode ?? 200, mergedHeaders)
      proxyRes.pipe(res)  // SSE streaming works through pipe
    })

    proxyReq.on('error', (err) => {
      this.log(`[mobile-gateway] proxy error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain', ...corsHeaders })
        res.end('Bad Gateway')
      }
    })

    req.pipe(proxyReq)

    res.on('finish', () => {
      this.log(`[mobile-gateway] ${req.method} ${targetPath} → ${res.statusCode} (${Date.now() - start}ms)`)
    })
  }

  // -----------------------------------------------------------------------
  // Desktop-local routes (`/v1/desktop/...`)
  //
  // Served by the gateway itself, never proxied to Kun. Exposes a mobile-safe
  // subset of desktop settings, schedule tasks/status, and the mobile-session
  // list (with secrets stripped). All routes require a valid bearer token
  // (the auth check already ran in handleRequest before dispatching here).
  // -----------------------------------------------------------------------

  private async handleDesktopLocalRequest(
    req: IncomingMessage,
    res: ServerResponse,
    targetPath: string,
    corsHeaders: Record<string, string>,
    start: number
  ): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase()
    const segments = targetPath.split('/').filter(Boolean)
    // segments[0] === 'v1', segments[1] === 'desktop', segments[2+] = resource path
    const resource = segments[2] ?? ''
    const params = segments.slice(3)

    const sendJson = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify(body))
      this.log(`[mobile-gateway] ${method} ${targetPath} → ${status} (${Date.now() - start}ms)`)
    }
    const sendError = (status: number, message: string): void => {
      sendJson(status, { ok: false, message })
    }

    try {
      // GET /v1/desktop/settings — mobile-safe settings snapshot
      if (method === 'GET' && resource === 'settings' && params.length === 0) {
        const settings = await this.settingsStore.load()
        sendJson(200, buildMobileSettingsSnapshot(settings))
        return
      }

      // GET /v1/desktop/schedule/tasks — list all scheduled tasks
      if (method === 'GET' && resource === 'schedule' && params[0] === 'tasks' && params.length === 1) {
        if (!this.deps.listScheduleTasks) return sendError(501, 'Schedule runtime not available.')
        const tasks = await this.deps.listScheduleTasks()
        sendJson(200, { tasks })
        return
      }

      // GET /v1/desktop/schedule/tasks/{id} — single task
      if (method === 'GET' && resource === 'schedule' && params[0] === 'tasks' && params.length === 2) {
        if (!this.deps.listScheduleTasks) return sendError(501, 'Schedule runtime not available.')
        const tasks = await this.deps.listScheduleTasks()
        const task = tasks.find((t) => t.id === params[1])
        if (!task) return sendError(404, 'Task not found.')
        sendJson(200, { task })
        return
      }

      // POST /v1/desktop/schedule/tasks/{id}/run — manual trigger
      if (
        method === 'POST' &&
        resource === 'schedule' &&
        params[0] === 'tasks' &&
        params.length === 3 &&
        params[2] === 'run'
      ) {
        if (!this.deps.runScheduleTask) return sendError(501, 'Schedule runtime not available.')
        const result = await this.deps.runScheduleTask(params[1])
        // Always 200 — the run request itself succeeded; `result.ok` carries
        // the task-level outcome (queued/running/failed) for the client.
        sendJson(200, { result })
        return
      }

      // PATCH /v1/desktop/schedule/tasks/{id} — weak write (enabled / schedule)
      if (method === 'PATCH' && resource === 'schedule' && params[0] === 'tasks' && params.length === 2) {
        if (!this.deps.updateScheduleTask) return sendError(501, 'Schedule runtime not available.')
        const body = await readJsonBody(req)
        const patch = sanitizeTaskPatch(body)
        if (!patch) return sendError(400, 'Invalid patch body.')
        const updated = await this.deps.updateScheduleTask(params[1], patch)
        if (!updated) return sendError(404, 'Task not found.')
        sendJson(200, { task: updated })
        return
      }

      // GET /v1/desktop/schedule/status — runtime status (running/queued ids)
      if (method === 'GET' && resource === 'schedule' && params[0] === 'status' && params.length === 1) {
        if (!this.deps.getScheduleStatus) return sendError(501, 'Schedule runtime not available.')
        const status = await this.deps.getScheduleStatus()
        sendJson(200, { status })
        return
      }

      // GET /v1/desktop/sessions — device list (no tokens; current flagged)
      if (method === 'GET' && resource === 'sessions' && params.length === 0) {
        const currentToken = extractBearerToken(req)
        const sessions = this.sessions.map((s) => ({
          ...toSessionSummary(s),
          current: s.token === currentToken
        }))
        sendJson(200, { sessions })
        return
      }

      return sendError(404, 'Not found.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`[mobile-gateway] desktop-local error: ${message}`)
      return sendError(500, 'Internal server error.')
    }
  }
}

// ---------------------------------------------------------------------------
// Desktop-local helpers
// ---------------------------------------------------------------------------

function extractBearerToken(req: IncomingMessage): string {
  const authHeader = req.headers.authorization ?? ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Reduce an arbitrary JSON body to the schedule-task fields the mobile app is
 * allowed to mutate: `enabled` and a partial `schedule`. Everything else
 * (prompt, model, workspaceRoot, ...) is owned by the desktop editor.
 *
 * The return type widens `schedule` to a partial because
 * `ScheduleRuntime.updateTaskById` merges `patch.schedule` onto the existing
 * task schedule (`{ ...task.schedule, ...patch.schedule }`) — it accepts and
 * expects partial schedule content even though its `Partial<ScheduledTaskV1>`
 * parameter type nominally requires a full `ScheduledTaskScheduleV1`.
 */
function sanitizeTaskPatch(body: unknown): Partial<ScheduledTaskV1> | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  type MobileTaskPatch = Omit<Partial<ScheduledTaskV1>, 'schedule'> & {
    schedule?: Partial<ScheduledTaskV1['schedule']>
  }
  const patch: MobileTaskPatch = {}
  if (typeof raw.enabled === 'boolean') patch.enabled = raw.enabled
  if (raw.schedule && typeof raw.schedule === 'object') {
    const schedRaw = raw.schedule as Record<string, unknown>
    const sched: Partial<ScheduledTaskV1['schedule']> = {}
    if (
      schedRaw.kind === 'manual' ||
      schedRaw.kind === 'interval' ||
      schedRaw.kind === 'daily' ||
      schedRaw.kind === 'at'
    ) {
      sched.kind = schedRaw.kind
    }
    if (typeof schedRaw.everyMinutes === 'number' && Number.isFinite(schedRaw.everyMinutes)) {
      sched.everyMinutes = schedRaw.everyMinutes
    }
    if (typeof schedRaw.timeOfDay === 'string') sched.timeOfDay = schedRaw.timeOfDay
    if (typeof schedRaw.atTime === 'string') sched.atTime = schedRaw.atTime
    patch.schedule = sched
  }
  return patch as Partial<ScheduledTaskV1>
}
