import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useConnectionStore } from '../../src/store/connection';
import { useThreadsStore } from '../../src/store/threads';
import { useEventsStore } from '../../src/store/events';
import { sendMessage } from '../../src/api/turns';
import { submitApproval } from '../../src/api/approvals';
import { submitUserInput } from '../../src/api/user-inputs';
import { MessageBubble } from '../../src/components/MessageBubble';
import { TodoList } from '../../src/components/TodoList';
import { ApprovalCard } from '../../src/components/ApprovalCard';
import { UserInputCard } from '../../src/components/UserInputCard';
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
  const approvals = useEventsStore((s) => s.approvals);
  const userInputs = useEventsStore((s) => s.userInputs);
  const removeApproval = useEventsStore((s) => s.removeApproval);
  const removeUserInput = useEventsStore((s) => s.removeUserInput);
  const addChatBlock = useEventsStore((s) => s.addChatBlock);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [approvalProcessing, setApprovalProcessing] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const threadId = id || '';

  // Fetch thread detail and todos
  useEffect(() => {
    if (threadId && connectionStatus === 'connected') {
      fetchThread(threadId);
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

  const threadApprovals = approvals[threadId] || [];
  const threadUserInputs = userInputs[threadId] || [];
  const threadTodos = todos[threadId] || [];

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if (!text || !threadId) return;

    setSending(true);
    try {
      addChatBlock(threadId, {
        id: `user_${Date.now()}`,
        kind: 'user_text',
        content: text,
        timestamp: new Date().toISOString(),
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
        await submitApproval(approvalId, 'allow');
        removeApproval(threadId, approvalId);
      } catch (err) {
        console.error('Failed to approve:', err);
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
        await submitApproval(approvalId, 'deny');
        removeApproval(threadId, approvalId);
      } catch (err) {
        console.error('Failed to deny:', err);
      } finally {
        setApprovalProcessing(null);
      }
    },
    [threadId]
  );

  const handleUserInput = useCallback(
    async (inputId: string, answer: string) => {
      try {
        await submitUserInput(inputId, answer);
        removeUserInput(threadId, inputId);
      } catch (err) {
        console.error('Failed to submit input:', err);
      }
    },
    [threadId]
  );

  // Build a combined list for the FlatList
  type ListItem =
    | { type: 'status'; key: string }
    | { type: 'todo'; key: string }
    | { type: 'approval'; key: string; approvalId: string }
    | { type: 'userInput'; key: string; inputId: string }
    | { type: 'block'; key: string; block: ChatBlock }
    | { type: 'usage'; key: string };

  const usage = useEventsStore((s) => s.usage[threadId]);

  const listData: ListItem[] = [
    { type: 'status', key: 'status' },
    ...(threadTodos.length > 0 ? [{ type: 'todo' as const, key: 'todos' }] : []),
    ...threadApprovals.map((a) => ({
      type: 'approval' as const,
      key: `approval_${a.id}`,
      approvalId: a.id,
    })),
    ...threadUserInputs.map((u) => ({
      type: 'userInput' as const,
      key: `input_${u.id}`,
      inputId: u.id,
    })),
    ...blocks.map((b) => ({
      type: 'block' as const,
      key: `block_${b.id}`,
      block: b,
    })),
    ...(usage ? [{ type: 'usage' as const, key: 'usage' }] : []),
  ];

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'status':
          return <StatusBar status={connectionStatus} />;
        case 'todo':
          return <TodoList todos={threadTodos} />;
        case 'approval': {
          const a = threadApprovals.find((ap) => ap.id === item.approvalId);
          if (!a) return null;
          return (
            <ApprovalCard
              approval={a}
              onApprove={() => handleApprove(a.id)}
              onDeny={() => handleDeny(a.id)}
              processing={approvalProcessing === a.id}
            />
          );
        }
        case 'userInput': {
          const u = threadUserInputs.find((ui) => ui.id === item.inputId);
          if (!u) return null;
          return (
            <UserInputCard
              request={u}
              onSubmit={(answer) => handleUserInput(u.id, answer)}
            />
          );
        }
        case 'block':
          return <MessageBubble block={item.block} />;
        case 'usage':
          return usage ? (
            <View style={usageStyles.container}>
              <Text style={usageStyles.title}>Usage</Text>
              <Text style={usageStyles.text}>
                Tokens: {usage.totalTokens.toLocaleString()} (prompt: {usage.promptTokens.toLocaleString()}, completion: {usage.completionTokens.toLocaleString()})
              </Text>
              {usage.promptCacheHitTokens != null && (
                <Text style={usageStyles.text}>
                  Cache: {usage.promptCacheHitTokens.toLocaleString()} hit / {usage.promptCacheMissTokens?.toLocaleString() || '0'} miss
                </Text>
              )}
              {usage.cost != null && (
                <Text style={usageStyles.text}>
                  Cost: ${usage.cost.toFixed(4)}
                </Text>
              )}
            </View>
          ) : null;
        default:
          return null;
      }
    },
    [
      connectionStatus,
      threadTodos,
      threadApprovals,
      threadUserInputs,
      approvalProcessing,
      usage,
      handleApprove,
      handleDeny,
      handleUserInput,
    ]
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

      {/* Composer */}
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={message}
          onChangeText={setMessage}
          placeholder="Send a message..."
          placeholderTextColor="#8492b1"
          multiline
          maxLength={4000}
          editable={!sending}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!message.trim() || sending) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!message.trim() || sending}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="send" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
    backgroundColor: '#f3f5fc',
    borderTopWidth: 1,
    borderTopColor: 'rgba(20,47,95,0.13)',
  },
  composerInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#233659',
    maxHeight: 120,
    marginRight: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3b82d8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});

const usageStyles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: '#54678c',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  text: {
    fontSize: 12,
    color: '#54678c',
    marginTop: 2,
  },
});
