import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ThreadSummary } from '../types/api';
import { MaterialIcons } from '@expo/vector-icons';

interface Props {
  thread: ThreadSummary;
  onPress: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#3b82d8',
  idle: '#8492b1',
  archived: '#8492b1',
  deleted: '#d6493f',
};

export function ThreadCard({ thread, onPress }: Props) {
  const statusColor = STATUS_COLORS[thread.status] || STATUS_COLORS.idle;
  const todoItems = thread.todos?.items ?? [];
  const total = todoItems.length;
  const completed = todoItems.filter((t) => t.status === 'completed').length;
  const todoPercent = total > 0 ? Math.round((completed / total) * 100) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.title} numberOfLines={1}>
          {thread.title || 'Untitled Thread'}
        </Text>
        <MaterialIcons name="chevron-right" size={20} color="#8492b1" />
      </View>

      {thread.model ? (
        <Text style={styles.model} numberOfLines={1}>
          {thread.model}
        </Text>
      ) : null}

      {todoPercent !== null ? (
        <View style={styles.todoRow}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${todoPercent}%` }]} />
          </View>
          <Text style={styles.todoText}>
            {completed}/{total}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#233659',
  },
  model: {
    fontSize: 12,
    color: '#54678c',
    marginTop: 6,
    marginLeft: 20,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginLeft: 20,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(20,47,95,0.1)',
    marginRight: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#128a4a',
  },
  todoText: {
    fontSize: 11,
    color: '#8492b1',
  },
});
