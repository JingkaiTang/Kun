import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useConnectionStore } from '../../src/store/connection';
import { useThreadsStore } from '../../src/store/threads';
import { useEventsStore } from '../../src/store/events';
import { sendMessage } from '../../src/api/turns';
import { submitApproval } from '../../src/api/approvals';
import { submitUserInput } from '../../src/api/user-inputs';
import { MessageBubble } from '../../src/components/MessageBubble';
import { Composer } from '../../src/components/Composer';
import { TodoList } from '../../src/components/TodoList';
import { StatusBar } from '../../src/components/StatusBar';
import { EmptyState } from '../../src/components/EmptyState';
import type { ChatBlock } from '../../src/types/api';

export default function ThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const baseUrl = useConnectionStore((s) => s.baseUrl);
  const token = useConnectionStore((s) => s.token);
  const connectionStatus = useConnectionStore((s) => s.status);

  const fetchThread = useThreadsStore((s) => s.fetchThread);
  const fetchTodos = useThreadsStore((s) => s.fetchTodos);
  const threadDetails = useThreadsStore((s) => s.threadDetails);
  const todos = useThreadsStore((s) => s.todos);

  const connectSSE = useEventsStore((s) => s.connectSSE);
  const disconnectSSE = useEventsStore((s) => s.disconnectSSE);
  const chatBlocks = useEventsStore((s) => s.chatBlocks);
  const resolveApproval = useEventsStore((s) => s.resolveApproval);
  const resolveUserInput = useEventsStore((s) => s.resolveUserInput);
  const addChatBlock = useEventsStore((s) => s.addChatBlock);
  const setChatBlocks = useEventsStore((s) => s.setChatBlocks);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [approvalProcessing, setApprovalProcessing] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const threadId = id || '';

  // Fetch thread detail and todos
  useEffect(() => {
    if (threadId && connectionStatus === 'connected') {
      fetchThread(threadId).then(() => {
        const detail = useThreadsStore.getState().threadDetails[threadId];
        if (detail?.chatBlocks) {
          setChatBlocks(threadId, detail.chatBlocks);
        }
      });
      fetchTodos(threadId);
    }
  }, [threadId, connectionStatus]);

  // Connect SSE
  useEffect(() => {
    if (threadId && baseUrl && token && connectionStatus === 'connected') {
      connectSSE(baseUrl, token, threadId);
    }
    return () => {
      disconnectSSE();
    };
  }, [threadId, baseUrl, token, connectionStatus]);

  // Update header title
  useEffect(() => {
    const detail = threadDetails[threadId];
    if (detail?.title) {
      router.setParams({ title: detail.title });
    }
  }, [threadDetails[threadId]?.title]);

  // Auto-scroll on new messages
  const blocks = chatBlocks[threadId] || [];
  useEffect(() => {
    if (blocks.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [blocks.length]);

  const threadTodos = todos[threadId] || [];

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if (!text || !threadId) return;

    setSending(true);
    try {
      addChatBlock(threadId, {
        id: `user_${Date.now()}`,
        kind: 'user',
        text,
        createdAt: new Date().toISOString(),
      });
      setMessage('');
      await sendMessage(threadId, text);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  }, [message, threadId]);

  const handleApprove = useCallback(
    async (approvalId: string) => {
      setApprovalProcessing(approvalId);
      try {
        resolveApproval(threadId, approvalId, 'submitting');
        await submitApproval(approvalId, 'allow');
        resolveApproval(threadId, approvalId, 'allowed');
      } catch (err) {
        console.error('Failed to approve:', err);
        resolveApproval(threadId, approvalId, 'error', 'Failed to approve');
      } finally {
        setApprovalProcessing(null);
      }
    },
    [threadId]
  );

  const handleDeny = useCallback(
    async (approvalId: string) => {
      setApprovalProcessing(approvalId);
      try {
        resolveApproval(threadId, approvalId, 'submitting');
        await submitApproval(approvalId, 'deny');
        resolveApproval(threadId, approvalId, 'denied');
      } catch (err) {
        console.error('Failed to deny:', err);
        resolveApproval(threadId, approvalId, 'error', 'Failed to deny');
      } finally {
        setApprovalProcessing(null);
      }
    },
    [threadId]
  );

  const handleUserInput = useCallback(
    async (requestId: string, answer: string) => {
      try {
        resolveUserInput(threadId, requestId, answer);
        await submitUserInput(requestId, answer);
      } catch (err) {
        console.error('Failed to submit input:', err);
      }
    },
    [threadId]
  );

  // Build list data
  type ListItem =
    | { type: 'status'; key: string }
    | { type: 'todo'; key: string }
    | { type: 'block'; key: string; block: ChatBlock };

  const listData: ListItem[] = [
    { type: 'status', key: 'status' },
    ...(threadTodos.length > 0 ? [{ type: 'todo' as const, key: 'todos' }] : []),
    ...blocks.map((b) => ({
      type: 'block' as const,
      key: `block_${b.id}`,
      block: b,
    })),
  ];

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'status':
          return <StatusBar status={connectionStatus} />;
        case 'todo':
          return <TodoList todos={threadTodos} />;
        case 'block':
          return (
            <MessageBubble
              block={item.block}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onUserInput={handleUserInput}
              processing={approvalProcessing !== null}
            />
          );
        default:
          return null;
      }
    },
    [connectionStatus, threadTodos, approvalProcessing, handleApprove, handleDeny, handleUserInput]
  );

  if (!threadId) {
    return <EmptyState message="Thread not found." />;
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

      <Composer
        value={message}
        onChangeText={setMessage}
        onSend={handleSend}
        sending={sending}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbff',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
});
