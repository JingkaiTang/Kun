import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useConnectionStore } from '../../src/store/connection';
import { useChatStore } from '../../src/store/chat-store';
import { MessageBubble } from '../../src/components/MessageBubble';
import { Composer } from '../../src/components/Composer';
import { TodoList } from '../../src/components/TodoList';
import { StatusBar } from '../../src/components/StatusBar';
import { EmptyState } from '../../src/components/EmptyState';
import type { ChatBlock, UserInputAnswer } from '../../src/agent/types';

type ListItem =
  | { type: 'status'; key: 'status' }
  | { type: 'todo'; key: 'todos' }
  | { type: 'block'; key: string; block: ChatBlock }
  | { type: 'live'; key: 'live'; liveReasoning: string; liveAssistant: string };

export default function ThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = id || '';

  const connectionStatus = useConnectionStore((s) => s.status);

  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const blocks = useChatStore((s) => s.blocks);
  const liveReasoning = useChatStore((s) => s.liveReasoning);
  const liveAssistant = useChatStore((s) => s.liveAssistant);
  const busy = useChatStore((s) => s.busy);
  const error = useChatStore((s) => s.error);
  const activeThreadTodos = useChatStore((s) => s.activeThreadTodos);
  const approvalStatusByBlock = useChatStore((s) => s.approvalStatusByBlock);
  const userInputStatusByBlock = useChatStore((s) => s.userInputStatusByBlock);
  const selectThread = useChatStore((s) => s.selectThread);
  const closeThread = useChatStore((s) => s.closeThread);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const interrupt = useChatStore((s) => s.interrupt);
  const steer = useChatStore((s) => s.steer);
  const resolveApproval = useChatStore((s) => s.resolveApproval);
  const resolveUserInput = useChatStore((s) => s.resolveUserInput);
  const clearError = useChatStore((s) => s.clearError);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Select the thread when entering the screen; close the subscription on unmount.
  useEffect(() => {
    if (threadId && connectionStatus === 'connected') {
      void selectThread(threadId);
    }
    return () => {
      closeThread();
    };
  }, [threadId, connectionStatus, selectThread, closeThread]);

  const hasLiveContent = !!(liveReasoning.trim() || liveAssistant.trim());

  const listData: ListItem[] = useMemo(() => {
    const items: ListItem[] = [{ type: 'status', key: 'status' }];
    if (activeThreadTodos && activeThreadTodos.items.length > 0) {
      items.push({ type: 'todo', key: 'todos' });
    }
    for (const block of blocks) {
      items.push({ type: 'block', key: `block_${block.id}`, block });
    }
    if (hasLiveContent) {
      items.push({
        type: 'live',
        key: 'live',
        liveReasoning,
        liveAssistant,
      });
    }
    return items;
  }, [blocks, activeThreadTodos, hasLiveContent, liveReasoning, liveAssistant]);

  // Auto-scroll on new content.
  const itemCount = listData.length;
  useEffect(() => {
    if (itemCount > 0) {
      const t = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [itemCount]);

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if (!text || !threadId) return;
    setSending(true);
    try {
      const ok = await sendMessage(text);
      if (ok) setMessage('');
    } finally {
      setSending(false);
    }
  }, [message, threadId, sendMessage]);

  const handleSteer = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessage('');
      await steer(trimmed);
    },
    [steer]
  );

  const handleInterrupt = useCallback(() => {
    void interrupt({ discard: false });
  }, [interrupt]);

  const handleApprove = useCallback(
    (blockId: string) => {
      void resolveApproval(blockId, 'allow');
    },
    [resolveApproval]
  );

  const handleDeny = useCallback(
    (blockId: string) => {
      void resolveApproval(blockId, 'deny');
    },
    [resolveApproval]
  );

  const handleSubmitUserInput = useCallback(
    (blockId: string, answers: UserInputAnswer[]) => {
      void resolveUserInput(blockId, { kind: 'submit', answers });
    },
    [resolveUserInput]
  );

  const handleCancelUserInput = useCallback(
    (blockId: string) => {
      void resolveUserInput(blockId, { kind: 'cancel' });
    },
    [resolveUserInput]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'status':
          return <StatusBar status={connectionStatus} />;
        case 'todo':
          return activeThreadTodos ? <TodoList todos={activeThreadTodos.items} /> : null;
        case 'block':
          return (
            <MessageBubble
              block={item.block}
              approvalStatus={approvalStatusByBlock[item.block.id]}
              userInputStatus={userInputStatusByBlock[item.block.id]}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onSubmitUserInput={handleSubmitUserInput}
              onCancelUserInput={handleCancelUserInput}
            />
          );
        case 'live':
          return (
            <LiveStreamingBubble
              reasoning={item.liveReasoning}
              assistant={item.liveAssistant}
            />
          );
        default:
          return null;
      }
    },
    [
      connectionStatus,
      activeThreadTodos,
      approvalStatusByBlock,
      userInputStatusByBlock,
      handleApprove,
      handleDeny,
      handleSubmitUserInput,
      handleCancelUserInput,
    ]
  );

  if (!threadId) {
    return <EmptyState message="Thread not found." />;
  }

  if (activeThreadId !== threadId) {
    // selectThread is in flight; render an empty container to avoid
    // flashing stale blocks from the previous thread.
    return (
      <View style={styles.container}>
        <StatusBar status={connectionStatus} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={listData}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
      />
      {error ? (
        <View style={styles.errorBar}>
          <MaterialIcons name="error-outline" size={16} color="#d6493f" />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
          <TouchableOpacity onPress={clearError} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={16} color="#8492b1" />
          </TouchableOpacity>
        </View>
      ) : null}
      <Composer
        value={message}
        onChangeText={setMessage}
        onSend={handleSend}
        onSteer={handleSteer}
        onInterrupt={handleInterrupt}
        busy={busy}
        sending={sending}
        disabled={connectionStatus !== 'connected'}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * Streaming preview bubble — shows in-progress reasoning and assistant
 * text before they're flushed to committed blocks. Mirrors desktop's
 * liveReasoning / liveAssistant rendering.
 */
function LiveStreamingBubble({
  reasoning,
  assistant,
}: {
  reasoning: string;
  assistant: string;
}) {
  return (
    <View style={liveStyles.container}>
      {reasoning.trim() ? (
        <View style={[liveStyles.bubble, liveStyles.reasoningBubble]}>
          <View style={liveStyles.header}>
            <MaterialIcons name="psychology" size={14} color="#7a68e8" />
            <View style={[liveStyles.dot, { backgroundColor: '#7a68e8' }]} />
            <Text style={[liveStyles.label, { color: '#7a68e8' }]}>Thinking</Text>
          </View>
          <Text style={[liveStyles.text, { color: '#54678c' }]} selectable>
            {reasoning}
            <Text style={liveStyles.cursor}>▍</Text>
          </Text>
        </View>
      ) : null}
      {assistant.trim() ? (
        <View style={[liveStyles.bubble, liveStyles.assistantBubble]}>
          <View style={liveStyles.header}>
            <MaterialIcons name="auto-awesome" size={14} color="#3b82d8" />
            <View style={[liveStyles.dot, { backgroundColor: '#3b82d8' }]} />
            <Text style={[liveStyles.label, { color: '#3b82d8' }]}>Assistant</Text>
          </View>
          <Text style={[liveStyles.text, { color: '#233659' }]} selectable>
            {assistant}
            <Text style={liveStyles.cursor}>▍</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const liveStyles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 3,
    gap: 6,
  },
  bubble: {
    maxWidth: '85%',
    alignSelf: 'flex-start',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  reasoningBubble: {
    backgroundColor: 'rgba(122,104,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.2)',
    borderBottomLeftRadius: 4,
  },
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.1)',
    borderBottomLeftRadius: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  cursor: {
    color: '#7a68e8',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbff',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(214,73,63,0.06)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(214,73,63,0.2)',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#d6493f',
  },
});
