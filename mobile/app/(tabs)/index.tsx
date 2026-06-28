import React, { useCallback, useEffect } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnectionStore } from '../../src/store/connection';
import { useChatStore } from '../../src/store/chat-store';
import { ThreadCard } from '../../src/components/ThreadCard';
import { EmptyState } from '../../src/components/EmptyState';
import { StatusBar } from '../../src/components/StatusBar';
import type { NormalizedThread } from '../../src/agent/types';

export default function DashboardScreen() {
  const router = useRouter();
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const connected = status === 'connected';

  const threads = useChatStore((s) => s.threads);
  const loading = useChatStore((s) => s.threadsLoading);
  const refreshThreads = useChatStore((s) => s.refreshThreads);

  useEffect(() => {
    if (connected) {
      void refreshThreads();
    }
  }, [connected, refreshThreads]);

  const handleRefresh = useCallback(() => {
    if (connected) {
      void refreshThreads();
    }
  }, [connected, refreshThreads]);

  const handlePressThread = useCallback(
    (id: string) => {
      router.push(`/thread/${id}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: NormalizedThread }) => (
      <ThreadCard thread={item} onPress={() => handlePressThread(item.id)} />
    ),
    [handlePressThread]
  );

  const keyExtractor = useCallback((item: NormalizedThread) => item.id, []);

  if (!connected) {
    return (
      <View style={styles.container}>
        <StatusBar status={status} />
        <EmptyState
          message={
            error ||
            'Not connected to a gateway. Go to Settings to configure the connection.'
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar status={status} />
      <FlatList
        data={threads}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor="#3b82d8"
            colors={['#3b82d8']}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <EmptyState message="No threads yet. Start a conversation from the Kun desktop app." />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbff',
  },
  list: {
    paddingVertical: 8,
    flexGrow: 1,
  },
});
