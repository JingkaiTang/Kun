import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone, Copy, RefreshCw, Trash2, Plus, Check, AlertCircle } from 'lucide-react'
import type { MobileSessionV1 } from '@shared/mobile-api-types'

// ---------------------------------------------------------------------------
// IPC helpers — use the same bridge as other settings sections
// ---------------------------------------------------------------------------

async function ipc<T>(channel: string, payload?: unknown): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).kunGui.invoke(channel, payload) as Promise<T>
}

// ---------------------------------------------------------------------------
// Inline components (reuse patterns from settings-controls.tsx)
// ---------------------------------------------------------------------------

function SettingRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[13px] text-ds-muted">{label}</span>
      {children}
    </div>
  )
}

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {copied ? copiedLabel : label}
    </button>
  )
}

function Toggle({ enabled, onToggle, disabled = false }: { enabled: boolean; onToggle: () => void; disabled?: boolean }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        enabled ? 'bg-accent' : 'bg-ds-border-muted'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MobileSettingsSection(): ReactElement {
  const { t } = useTranslation('common')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatewayEnabled, setGatewayEnabled] = useState(false)
  const [gatewayPort, setGatewayPort] = useState(0)
  const [sessions, setSessions] = useState<MobileSessionV1[]>([])
  const [lanIp, setLanIp] = useState('127.0.0.1')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const status = await ipc<{
        gatewayEnabled: boolean
        port: number
        sessions: MobileSessionV1[]
        lanIp: string
      }>('mobile:getStatus')
      setGatewayEnabled(status.gatewayEnabled)
      setGatewayPort(status.port)
      setSessions(status.sessions)
      setLanIp(status.lanIp)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mobileFailedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleToggleGateway = useCallback(async () => {
    setActionLoading(true)
    setError(null)
    try {
      if (gatewayEnabled) {
        await ipc('mobile:stopGateway')
        setGatewayEnabled(false)
        setGatewayPort(0)
      } else {
        const result = await ipc<{ port: number }>('mobile:startGateway')
        setGatewayEnabled(true)
        setGatewayPort(result.port)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('mobileFailedToToggle')
      setError(msg.includes('not reachable')
        ? t('mobileNotReachable')
        : msg)
    } finally {
      setActionLoading(false)
    }
  }, [gatewayEnabled, t])

  const handleAddDevice = useCallback(async () => {
    const name = prompt(t('mobilePromptDeviceName'))
    if (!name?.trim()) return
    setActionLoading(true)
    setError(null)
    try {
      const session = await ipc<MobileSessionV1>('mobile:createSession', { name: name.trim() })
      setSessions((prev) => [...prev, session])
      setNewToken(session.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mobileFailedToCreate'))
    } finally {
      setActionLoading(false)
    }
  }, [t])

  const handleRefreshToken = useCallback(async (id: string) => {
    setActionLoading(true)
    setError(null)
    try {
      const updated = await ipc<MobileSessionV1>('mobile:refreshToken', { id })
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)))
      setNewToken(updated.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mobileFailedToRefresh'))
    } finally {
      setActionLoading(false)
    }
  }, [t])

  const handleRevoke = useCallback(async (id: string) => {
    if (!confirm(t('mobileConfirmRevoke'))) return
    setActionLoading(true)
    setError(null)
    try {
      await ipc('mobile:revokeSession', { id })
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mobileFailedToRevoke'))
    } finally {
      setActionLoading(false)
    }
  }, [t])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-ds-muted">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        {t('loading')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-1">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Smartphone className="h-5 w-5 text-ds-muted" />
        <h2 className="text-[16px] font-semibold text-ds-ink">{t('mobile')}</h2>
      </div>

      <p className="text-[13px] text-ds-muted">
        {t('mobileDescription')}
      </p>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300/50 bg-red-50/80 px-4 py-3 text-[13px] text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800">
            {t('mobileDismiss')}
          </button>
        </div>
      )}

      {/* Gateway toggle */}
      <div className="rounded-xl border border-ds-border bg-ds-card p-4">
        <SettingRow label={t('mobileGatewayToggle')}>
          <Toggle enabled={gatewayEnabled} onToggle={handleToggleGateway} disabled={actionLoading} />
        </SettingRow>
        <p className="mt-1 text-[12px] text-ds-faint">
          {gatewayEnabled ? t('mobileGatewayEnabled') : t('mobileGatewayDisabled')}
        </p>

        {gatewayEnabled && (
          <div className="mt-4 flex flex-col gap-3 border-t border-ds-border pt-4">
            <SettingRow label={t('mobileLanIp')}>
              <div className="flex items-center gap-2">
                <code className="rounded-lg bg-ds-subtle px-2.5 py-1 text-[13px] text-ds-ink">{lanIp}</code>
                <CopyButton text={lanIp} label={t('mobileCopy')} copiedLabel={t('mobileCopied')} />
              </div>
            </SettingRow>
            <SettingRow label={t('mobileGatewayPort')}>
              <div className="flex items-center gap-2">
                <code className="rounded-lg bg-ds-subtle px-2.5 py-1 text-[13px] text-ds-ink">{String(gatewayPort)}</code>
                <CopyButton text={String(gatewayPort)} label={t('mobileCopy')} copiedLabel={t('mobileCopied')} />
              </div>
            </SettingRow>
          </div>
        )}
      </div>

      {/* New token display */}
      {newToken && (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50/80 p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-amber-900">
            <AlertCircle className="h-4 w-4" />
            {t('mobileNewTokenTitle')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-amber-100 px-3 py-2 text-[12px] text-amber-950">
              {newToken}
            </code>
            <CopyButton text={newToken} label={t('mobileNewTokenCopy')} copiedLabel={t('mobileCopied')} />
          </div>
          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-2 text-[12px] text-amber-800 underline hover:text-amber-950"
          >
            {t('mobileDismiss')}
          </button>
        </div>
      )}

      {/* Paired devices */}
      <div className="rounded-xl border border-ds-border bg-ds-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-medium text-ds-ink">{t('mobilePairedDevices')}</h3>
          <button
            type="button"
            onClick={handleAddDevice}
            disabled={actionLoading}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {t('mobileAddDevice')}
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className="mt-4 text-center text-[13px] text-ds-faint">{t('mobileNoDevices')}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between rounded-lg border border-ds-border bg-ds-subtle px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ds-ink">{session.name}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ds-faint">
                    <span>{t('mobileDeviceToken')}: {session.token.slice(0, 8)}...{session.token.slice(-4)}</span>
                    <span>{t('mobileDeviceCreated')}: {new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRefreshToken(session.id)}
                    disabled={actionLoading}
                    title={t('mobileRefreshToken')}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(session.id)}
                    disabled={actionLoading}
                    title={t('mobileRevoke')}
                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection instructions */}
      {gatewayEnabled && (
        <div className="rounded-xl border border-ds-border bg-ds-card p-4">
          <h3 className="text-[14px] font-medium text-ds-ink">{t('mobileConnectionInstructions')}</h3>
          <ol className="mt-3 flex flex-col gap-2 text-[13px] text-ds-muted">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">1</span>
              {t('mobileStep1')}
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">2</span>
              {t('mobileStep2')} <code className="rounded bg-ds-subtle px-1.5 py-0.5 text-[12px]">{lanIp}:{String(gatewayPort)}</code>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">3</span>
              {t('mobileStep3')}
            </li>
          </ol>
        </div>
      )}
    </div>
  )
}
