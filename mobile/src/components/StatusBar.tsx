import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ConnectionStatus } from '../store/connection';

interface Props {
  status: ConnectionStatus;
}

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; label: string }> = {
  connected: { color: '#128a4a', label: 'Connected' },
  connecting: { color: '#3b82d8', label: 'Connecting...' },
  reconnecting: { color: '#e5a50b', label: 'Reconnecting' },
  disconnected: { color: '#d6493f', label: 'Disconnected' },
};

export function StatusBar({ status }: Props) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
