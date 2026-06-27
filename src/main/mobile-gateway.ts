import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AppSettingsV1 } from '../shared/app-settings-types'
import type { MobileSessionV1 } from '../shared/mobile-api-types'
import { validateToken } from './mobile-session'

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

export class MobileGateway {
  private server: Server | null = null
  private port = 0
  private kunPort = 0
  private sessions: MobileSessionV1[]
  private readonly settingsStore: { load(): Promise<AppSettingsV1> }
  private readonly log: (msg: string) => void

  constructor(
    settingsStore: { load(): Promise<AppSettingsV1> },
    sessions: MobileSessionV1[],
    log: (msg: string) => void
  ) {
    this.settingsStore = settingsStore
    this.sessions = sessions
    this.log = log
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

    // 4. Whitelist check
    if (!matchWhitelist(req.method, targetPath)) {
      res.writeHead(404, { 'content-type': 'text/plain', ...corsHeaders })
      res.end('Not Found')
      this.log(`[mobile-gateway] ${req.method} ${targetPath} → 404 (whitelist) ${Date.now() - start}ms`)
      return
    }

    // 5. Proxy to Kun API — remove hop-by-hop and upstream-incorrect headers
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
}
