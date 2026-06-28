import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ThreadTodoItem } from '../agent/types';

interface Props {
  todos: ThreadTodoItem[];
}

const STATUS_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  pending: 'radio-button-unchecked',
  in_progress: 'autorenew',
  completed: 'check-circle',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#8492b1',
  in_progress: '#3b82d8',
  completed: '#128a4a',
};

export function TodoList({ todos }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!todos || todos.length === 0) return null;

  const completedCount = todos.filter((t) => t.status === 'completed').length;

  return (
    <View style={styles.container}>
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

      {!collapsed &&
        todos.map((todo) => (
          <View key={todo.id} style={styles.item}>
            <MaterialIcons
              name={STATUS_ICON[todo.status] || 'radio-button-unchecked'}
              size={16}
              color={STATUS_COLOR[todo.status] || '#8492b1'}
            />
            <Text
              style={[
                styles.itemText,
                todo.status === 'completed' && styles.itemCompleted,
              ]}
              numberOfLines={2}
            >
              {todo.content}
            </Text>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  header: {
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
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingLeft: 4,
  },
  itemText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#233659',
    lineHeight: 18,
  },
  itemCompleted: {
    textDecorationLine: 'line-through',
    color: '#8492b1',
  },
});
