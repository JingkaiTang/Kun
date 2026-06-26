import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ChatBlock } from '../types/api';

interface Props {
  block: ChatBlock;
}

export function MessageBubble({ block }: Props) {
  const isUser = block.kind === 'user_text';
  const isAssistant = block.kind === 'assistant_text';
  const isTool = block.kind === 'tool_call' || block.kind === 'tool_result';
  const isError = block.kind === 'error';
  const isSystem = block.kind === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemContainer}>
        <Text style={styles.systemText}>{block.content}</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.rowRight : styles.rowLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser && styles.userBubble,
          isAssistant && styles.assistantBubble,
          isTool && styles.toolBubble,
          isError && styles.errorBubble,
        ]}
      >
        {isTool && block.toolName ? (
          <Text style={styles.toolName}>{block.toolName}</Text>
        ) : null}
        <Text
          style={[
            styles.content,
            isUser && styles.userContent,
            isError && styles.errorContent,
            isTool && styles.toolContent,
          ]}
          selectable
        >
          {block.content}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginVertical: 3,
    marginHorizontal: 16,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: '#3b82d8',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    borderBottomLeftRadius: 4,
  },
  toolBubble: {
    backgroundColor: 'rgba(122,104,232,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.25)',
    borderBottomLeftRadius: 4,
  },
  errorBubble: {
    backgroundColor: 'rgba(214,73,63,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(214,73,63,0.3)',
    borderBottomLeftRadius: 4,
  },
  content: {
    fontSize: 14,
    lineHeight: 20,
    color: '#233659',
  },
  userContent: {
    color: '#fff',
  },
  toolName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7a68e8',
    marginBottom: 3,
  },
  toolContent: {
    fontSize: 13,
    color: '#54678c',
  },
  errorContent: {
    color: '#d6493f',
  },
  systemContainer: {
    alignItems: 'center',
    marginVertical: 6,
    marginHorizontal: 16,
  },
  systemText: {
    fontSize: 11,
    color: '#8492b1',
    fontStyle: 'italic',
  },
});
