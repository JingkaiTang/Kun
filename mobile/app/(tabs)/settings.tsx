import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useConnectionStore } from '../../src/store/connection';
import { useDesktopStore } from '../../src/store/desktop-store';
import { StatusBar } from '../../src/components/StatusBar';
import type {
  DesktopScheduleTask,
  DesktopScheduleTaskStatus,
  DesktopSettingsSnapshot,
} from '../../src/agent/desktop-contract';

type Tab = 'connection' | 'schedule' | 'about';

export default function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('connection');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TabBar tab={tab} onChange={setTab} />
      {tab === 'connection' && <ConnectionTab />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'about' && <AboutTab />}
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
    { key: 'connection', label: 'Connection', icon: 'link' },
    { key: 'schedule', label: 'Schedule', icon: 'schedule' },
    { key: 'about', label: 'About', icon: 'info-outline' },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => {
        const active = tab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={t.icon}
              size={18}
              color={active ? '#3b82d8' : '#8492b1'}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Connection tab (existing form, extracted verbatim)
// ---------------------------------------------------------------------------

function ConnectionTab() {
  const { baseUrl, token, status, error, connect, disconnect } =
    useConnectionStore();

  const [hostInput, setHostInput] = useState(baseUrl || '');
  const [tokenInput, setTokenInput] = useState(token || '');
  const [connecting, setConnecting] = useState(false);

  const connected = status === 'connected';

  const handleConnect = useCallback(async () => {
    const host = hostInput.trim();
    const tok = tokenInput.trim();

    if (!host) {
      Alert.alert('Error', 'Please enter the gateway address.');
      return;
    }
    if (!tok) {
      Alert.alert('Error', 'Please enter the access token.');
      return;
    }

    let normalized = host;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `http://${normalized}`;
    }

    setConnecting(true);
    const ok = await connect(normalized, tok);
    setConnecting(false);

    if (!ok) {
      Alert.alert(
        'Connection Failed',
        'Cannot reach the gateway. Check the address and ensure the desktop app is running.'
      );
    }
  }, [hostInput, tokenInput, connect]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    setHostInput('');
    setTokenInput('');
  }, [disconnect]);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <StatusBar status={status} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Gateway Connection</Text>
        <Text style={styles.cardDescription}>
          Enter the address and token from your Kun desktop app. The gateway
          must be running and accessible on your network.
        </Text>

        <Text style={styles.label}>Address</Text>
        <TextInput
          style={styles.input}
          value={hostInput}
          onChangeText={setHostInput}
          placeholder="192.168.1.100:3456"
          placeholderTextColor="#8492b1"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!connected}
        />

        <Text style={styles.label}>Token</Text>
        <TextInput
          style={styles.input}
          value={tokenInput}
          onChangeText={setTokenInput}
          placeholder="Paste your access token"
          placeholderTextColor="#8492b1"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!connected}
        />

        {error ? (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={16} color="#d6493f" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!connected ? (
          <TouchableOpacity
            style={[styles.button, styles.connectBtn]}
            onPress={handleConnect}
            disabled={connecting}
            activeOpacity={0.7}
          >
            {connecting ? (
              <Text style={styles.buttonText}>Connecting...</Text>
            ) : (
              <>
                <MaterialIcons name="link" size={18} color="#fff" />
                <Text style={styles.buttonText}>Connect</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.disconnectBtn]}
            onPress={handleDisconnect}
            activeOpacity={0.7}
          >
            <MaterialIcons name="link-off" size={18} color="#fff" />
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.infoCard}>
        <MaterialIcons name="info-outline" size={18} color="#54678c" />
        <Text style={styles.infoText}>
          To get started, open the Kun desktop app, enable the Mobile Gateway
          in Settings, then enter the address and token shown there.
        </Text>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Schedule tab
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<DesktopScheduleTaskStatus, string> = {
  idle: '#8492b1',
  queued: '#e5a50b',
  running: '#3b82d8',
  success: '#128a4a',
  error: '#d6493f',
};

const STATUS_LABEL: Record<DesktopScheduleTaskStatus, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  error: 'Error',
};

function formatSchedule(task: DesktopScheduleTask): string {
  const s = task.schedule;
  switch (s.kind) {
    case 'manual':
      return 'Manual trigger';
    case 'interval':
      return `Every ${s.everyMinutes} min`;
    case 'daily':
      return `Daily at ${s.timeOfDay || '--:--'}`;
    case 'at':
      return `Once at ${s.atTime || '—'}`;
    default:
      return s.kind;
  }
}

function ScheduleTab() {
  const {
    scheduleTasks,
    scheduleTasksLoading,
    scheduleStatus,
    error,
    refreshSchedule,
    refreshScheduleStatus,
    runTask,
    toggleTaskEnabled,
  } = useDesktopStore();

  const [running, setRunning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void refreshSchedule();
    void refreshScheduleStatus();
  }, [refreshSchedule, refreshScheduleStatus]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshSchedule(), refreshScheduleStatus()]);
    setRefreshing(false);
  }, [refreshSchedule, refreshScheduleStatus]);

  const handleRun = useCallback(async (taskId: string) => {
    setRunning(taskId);
    const result = await runTask(taskId);
    setRunning(null);
    if (result && !result.ok) {
      Alert.alert('Run failed', result.message);
    } else if (result && result.ok) {
      const msg = result.queued
        ? 'Task queued.'
        : `Task started${result.threadId ? ` (thread ${result.threadId.slice(0, 8)})` : ''}.`;
      Alert.alert('Task triggered', msg);
    }
  }, [runTask]);

  const handleToggle = useCallback(async (taskId: string, enabled: boolean) => {
    const ok = await toggleTaskEnabled(taskId, enabled);
    if (!ok) {
      Alert.alert('Update failed', 'Could not toggle the task. See the error banner.');
    }
  }, [toggleTaskEnabled]);

  const runningIds = new Set(scheduleStatus?.runningTaskIds ?? []);
  const queuedIds = new Set(scheduleStatus?.queuedTaskIds ?? []);

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <ScheduleStatusCard status={scheduleStatus} />

      {error ? (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={16} color="#d6493f" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {scheduleTasksLoading && scheduleTasks.length === 0 ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color="#3b82d8" />
          <Text style={styles.emptyText}>Loading scheduled tasks…</Text>
        </View>
      ) : scheduleTasks.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialIcons name="schedule" size={32} color="#8492b1" />
          <Text style={styles.emptyText}>
            No scheduled tasks. Create one from the Kun desktop app.
          </Text>
        </View>
      ) : (
        scheduleTasks.map((task) => (
          <ScheduleTaskCard
            key={task.id}
            task={task}
            isRunning={runningIds.has(task.id)}
            isQueued={queuedIds.has(task.id)}
            isTriggering={running === task.id}
            onRun={() => handleRun(task.id)}
            onToggle={(enabled) => handleToggle(task.id, enabled)}
          />
        ))
      )}
    </ScrollView>
  );
}

function ScheduleStatusCard({
  status,
}: {
  status: { runningTaskIds: string[]; queuedTaskIds: string[]; internalServerRunning: boolean } | null;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Schedule Runtime</Text>
      <View style={styles.statusRow}>
        <MaterialIcons
          name={status?.internalServerRunning ? 'radio-button-checked' : 'radio-button-unchecked'}
          size={16}
          color={status?.internalServerRunning ? '#128a4a' : '#8492b1'}
        />
        <Text style={styles.statusText}>
          {status?.internalServerRunning ? 'Internal server running' : 'Internal server stopped'}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <MaterialIcons name="play-circle-outline" size={16} color="#3b82d8" />
        <Text style={styles.statusText}>
          {status?.runningTaskIds.length ?? 0} running
        </Text>
        <MaterialIcons name="queue" size={16} color="#e5a50b" style={{ marginLeft: 16 }} />
        <Text style={styles.statusText}>
          {status?.queuedTaskIds.length ?? 0} queued
        </Text>
      </View>
    </View>
  );
}

function ScheduleTaskCard({
  task,
  isRunning,
  isQueued,
  isTriggering,
  onRun,
  onToggle,
}: {
  task: DesktopScheduleTask;
  isRunning: boolean;
  isQueued: boolean;
  isTriggering: boolean;
  onRun: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  // Effective status: server's running/queued wins over stored lastStatus.
  const effectiveStatus: DesktopScheduleTaskStatus = isRunning
    ? 'running'
    : isQueued
    ? 'queued'
    : task.lastStatus;

  const statusColor = STATUS_COLOR[effectiveStatus] ?? STATUS_COLOR.idle;
  const statusLabel = STATUS_LABEL[effectiveStatus] ?? effectiveStatus;

  return (
    <View style={styles.card}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskTitle} numberOfLines={1}>{task.title || 'Untitled task'}</Text>
        <View style={[styles.statusPill, { backgroundColor: `${statusColor}22` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusPillLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.taskMetaRow}>
        <MaterialIcons name="schedule" size={14} color="#8492b1" />
        <Text style={styles.taskMeta}>{formatSchedule(task)}</Text>
        <MaterialIcons name="memory" size={14} color="#8492b1" style={{ marginLeft: 12 }} />
        <Text style={styles.taskMeta} numberOfLines={1}>{task.model || 'default'}</Text>
      </View>

      {task.lastMessage ? (
        <Text style={styles.taskMessage} numberOfLines={3}>{task.lastMessage}</Text>
      ) : null}

      <View style={styles.taskActions}>
        <TouchableOpacity
          style={[styles.taskButton, styles.toggleBtn, !task.enabled && styles.toggleBtnOff]}
          onPress={() => onToggle(!task.enabled)}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={task.enabled ? 'toggle-on' : 'toggle-off'}
            size={20}
            color={task.enabled ? '#128a4a' : '#8492b1'}
          />
          <Text style={[styles.taskButtonText, { color: task.enabled ? '#128a4a' : '#8492b1' }]}>
            {task.enabled ? 'Enabled' : 'Disabled'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.taskButton, styles.runBtn]}
          onPress={onRun}
          disabled={isTriggering || isRunning || isQueued}
          activeOpacity={0.7}
        >
          {isTriggering ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialIcons name="play-arrow" size={18} color="#fff" />
              <Text style={styles.taskButtonTextWhite}>
                {isRunning ? 'Running…' : isQueued ? 'Queued' : 'Run now'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// About tab
// ---------------------------------------------------------------------------

function AboutTab() {
  const { settings, settingsLoading, error, refreshSettings, sessions, refreshSessions } =
    useDesktopStore();

  useEffect(() => {
    void refreshSettings();
    void refreshSessions();
  }, [refreshSettings, refreshSessions]);

  if (settingsLoading && !settings) {
    return (
      <View style={styles.emptyCard}>
        <ActivityIndicator color="#3b82d8" />
        <Text style={styles.emptyText}>Loading desktop info…</Text>
      </View>
    );
  }

  if (!settings) {
    return (
      <View style={styles.emptyCard}>
        <MaterialIcons name="cloud-off" size={32} color="#8492b1" />
        <Text style={styles.emptyText}>
          {error || 'Desktop info unavailable. Make sure the gateway is connected.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => { void refreshSettings(); void refreshSessions(); }} />
      }
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Runtime</Text>
        <InfoRow icon="memory" label="Model" value={settings.model || '—'} />
        <InfoRow
          icon="dns"
          label="Provider"
          value={providerName(settings, settings.providerId)}
        />
        <InfoRow icon="public" label="Locale" value={settings.locale} />
        <InfoRow icon="palette" label="Theme" value={settings.theme} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Schedule</Text>
        <InfoRow
          icon="power-settings-new"
          label="Enabled"
          value={settings.schedule.enabled ? 'Yes' : 'No'}
        />
        <InfoRow icon="memory" label="Model" value={settings.schedule.model || '—'} />
        <InfoRow
          icon="dns"
          label="Provider"
          value={providerName(settings, settings.schedule.providerId) || 'Default'}
        />
        <InfoRow icon="view-list" label="Mode" value={settings.schedule.mode} />
        <InfoRow icon="assignment" label="Task count" value={String(settings.schedule.taskCount)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Mobile Gateway</Text>
        <InfoRow
          icon="router"
          label="Gateway"
          value={settings.mobile.gatewayEnabled ? 'Enabled' : 'Disabled'}
        />
        <InfoRow
          icon="devices"
          label="Paired devices"
          value={String(settings.mobile.sessionCount)}
        />
      </View>

      {sessions.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Devices</Text>
          {sessions.map((s) => (
            <View key={s.id} style={styles.sessionRow}>
              <MaterialIcons
                name={s.current ? 'phone-android' : 'tablet-android'}
                size={18}
                color={s.current ? '#3b82d8' : '#8492b1'}
              />
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionName}>{s.name}</Text>
                <Text style={styles.sessionDate}>
                  {new Date(s.createdAt).toLocaleDateString()}
                </Text>
              </View>
              {s.current ? (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>This device</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.infoCard}>
        <MaterialIcons name="info-outline" size={18} color="#54678c" />
        <Text style={styles.infoText}>
          Mobile can only view desktop-owned settings and trigger scheduled
          tasks. To change the model, provider, or workspace, open the Kun
          desktop app.
        </Text>
      </View>
    </ScrollView>
  );
}

function providerName(
  settings: DesktopSettingsSnapshot,
  providerId: string
): string {
  if (!providerId) return '—';
  const p = settings.providers.find((x) => x.id === providerId);
  return p?.name ?? providerId;
}

function InfoRow({ icon, label, value }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <MaterialIcons name={icon} size={16} color="#8492b1" />
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbff',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(20,47,95,0.08)',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#3b82d8',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8492b1',
  },
  tabLabelActive: {
    color: '#3b82d8',
  },
  scroll: {
    padding: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#233659',
    marginBottom: 12,
  },
  cardDescription: {
    fontSize: 13,
    color: '#54678c',
    lineHeight: 19,
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#54678c',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f3f5fc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    padding: 12,
    fontSize: 15,
    color: '#233659',
    marginBottom: 16,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(214,73,63,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#d6493f',
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
  },
  connectBtn: {
    backgroundColor: '#3b82d8',
  },
  disconnectBtn: {
    backgroundColor: '#d6493f',
  },
  buttonText: {
    marginLeft: 6,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  infoText: {
    marginLeft: 10,
    flex: 1,
    fontSize: 13,
    color: '#54678c',
    lineHeight: 19,
  },
  // Schedule tab
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 6,
  },
  statusText: {
    fontSize: 13,
    color: '#54678c',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyText: {
    fontSize: 13,
    color: '#54678c',
    textAlign: 'center',
    lineHeight: 19,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#233659',
    flex: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  taskMeta: {
    fontSize: 12,
    color: '#54678c',
    flexShrink: 1,
  },
  taskMessage: {
    fontSize: 12,
    color: '#54678c',
    backgroundColor: '#f3f5fc',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
    lineHeight: 17,
  },
  taskActions: {
    flexDirection: 'row',
    gap: 8,
  },
  taskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    backgroundColor: 'rgba(18,138,74,0.1)',
  },
  toggleBtnOff: {
    backgroundColor: 'rgba(132,146,177,0.12)',
  },
  taskButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  runBtn: {
    flex: 1,
    backgroundColor: '#3b82d8',
  },
  taskButtonTextWhite: {
    marginLeft: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  // About tab
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  infoRowLabel: {
    fontSize: 13,
    color: '#8492b1',
    width: 110,
  },
  infoRowValue: {
    fontSize: 13,
    color: '#233659',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(20,47,95,0.08)',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    fontSize: 14,
    color: '#233659',
    fontWeight: '500',
  },
  sessionDate: {
    fontSize: 12,
    color: '#8492b1',
    marginTop: 2,
  },
  currentBadge: {
    backgroundColor: 'rgba(59,130,216,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3b82d8',
  },
});
