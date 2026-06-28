import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ThreadTodoItem, ThreadTodoStatus } from '../agent/types';

interface Props {
  todos: ThreadTodoItem[];
  /** Mutate handler. When omitted, the list renders read-only. */
  onSetStatus?: (todoId: string, status: ThreadTodoStatus) => void;
  /** Clear-all handler. When omitted, no clear button is shown. */
  onClear?: () => void;
}

const STATUS_ORDER: ThreadTodoStatus[] = ['pending', 'in_progress', 'completed'];

const STATUS_ICON: Record<ThreadTodoStatus, keyof typeof MaterialIcons.glyphMap> = {
  pending: 'radio-button-unchecked',
  in_progress: 'autorenew',
  completed: 'check-circle',
};

const STATUS_COLOR: Record<ThreadTodoStatus, string> = {
  pending: '#8492b1',
  in_progress: '#3b82d8',
  completed: '#128a4a',
};

const STATUS_LABEL: Record<ThreadTodoStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
};

/** Cycle pending → in_progress → completed → pending. */
function nextStatus(status: ThreadTodoStatus): ThreadTodoStatus {
  if (status === 'pending') return 'in_progress';
  if (status === 'in_progress') return 'completed';
  return 'pending';
}

export function TodoList({ todos, onSetStatus, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!todos || todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  const pendingCount = Math.max(0, todos.length - completedCount - inProgressCount);
  const interactive = typeof onSetStatus === 'function';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.header}
          onPress={() => setCollapsed(!collapsed)}
          activeOpacity={0.7}
        >
          <MaterialIcons name="checklist" size={18} color="#54678c" />
          <Text style={styles.headerText}>
            Todos ({completedCount}/{todos.length})
          </Text>
          <MaterialIcons
            name={collapsed ? 'expand-more' : 'expand-less'}
            size={20}
            color="#8492b1"
          />
        </TouchableOpacity>
        {onClear ? (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
            accessibilityLabel="Clear all todos"
          >
            <MaterialIcons name="delete-outline" size={20} color="#d6493f" />
          </TouchableOpacity>
        ) : null}
      </View>

      {!collapsed ? (
        <>
          <View style={styles.statsRow}>
            <StatPill label="Pending" value={pendingCount} color={STATUS_COLOR.pending} />
            <StatPill label="In Progress" value={inProgressCount} color={STATUS_COLOR.in_progress} />
            <StatPill label="Completed" value={completedCount} color={STATUS_COLOR.completed} />
          </View>

          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              interactive={interactive}
              onSetStatus={onSetStatus}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statPill, { borderColor: `${color}33` }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function TodoRow({
  todo,
  interactive,
  onSetStatus,
}: {
  todo: ThreadTodoItem;
  interactive: boolean;
  onSetStatus?: (todoId: string, status: ThreadTodoStatus) => void;
}) {
  const color = STATUS_COLOR[todo.status];
  const cycle = () => {
    if (!onSetStatus) return;
    onSetStatus(todo.id, nextStatus(todo.status));
  };
  const setSpecific = (status: ThreadTodoStatus) => {
    if (!onSetStatus) return;
    onSetStatus(todo.id, status);
  };

  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <TouchableOpacity
          onPress={interactive ? cycle : undefined}
          disabled={!interactive}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <MaterialIcons
            name={STATUS_ICON[todo.status]}
            size={18}
            color={color}
          />
        </TouchableOpacity>
        <View style={styles.itemBody}>
          <Text
            style={[
              styles.itemText,
              todo.status === 'completed' && styles.itemCompleted,
            ]}
            numberOfLines={4}
          >
            {todo.content}
          </Text>
          {todo.source?.kind === 'plan' && todo.source.relativePath ? (
            <View style={styles.sourceChip}>
              <MaterialIcons name="description" size={11} color="#8492b1" />
              <Text style={styles.sourceText} numberOfLines={1}>
                {todo.source.relativePath}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {interactive ? (
        <View style={styles.statusPillsRow}>
          {STATUS_ORDER.map((status) => {
            const active = todo.status === status;
            const pillColor = STATUS_COLOR[status];
            return (
              <TouchableOpacity
                key={status}
                onPress={() => setSpecific(status)}
                activeOpacity={0.6}
                style={[
                  styles.statusPill,
                  active
                    ? { backgroundColor: `${pillColor}1f`, borderColor: `${pillColor}66` }
                    : null,
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    { color: active ? pillColor : '#8492b1' },
                  ]}
                >
                  {STATUS_LABEL[status]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  header: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#233659',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 6,
  },
  statPill: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(20,47,95,0.04)',
    borderWidth: 1,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: '#8492b1',
    textTransform: 'uppercase',
  },
  item: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(20,47,95,0.025)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.07)',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  itemBody: {
    flex: 1,
    marginLeft: 8,
  },
  itemText: {
    fontSize: 13,
    color: '#233659',
    lineHeight: 18,
  },
  itemCompleted: {
    textDecorationLine: 'line-through',
    color: '#8492b1',
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(20,47,95,0.05)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  sourceText: {
    fontSize: 11,
    color: '#8492b1',
    maxWidth: 220,
  },
  statusPillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    paddingLeft: 26,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.1)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
