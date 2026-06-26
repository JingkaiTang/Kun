import React, { useCallback, useEffect } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnectionStore } from '../../src/store/connection';
import { useThreadsStore } from '../../src/store/threads';
import { ThreadCard } from '../../src/components/ThreadCard';
import { EmptyState } from '../../src/components/EmptyState';
import { StatusBar } from '../../src/components/StatusBar';
import type { ThreadSummary } from '../../src/types/api';

export default function DashboardScreen() {
  const router = useRouter();
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const connected = status === 'connected';

  const threads = useThreadsStore((s) => s.threads);
  const loading = useThreadsStore((s) => s.loading);
  const fetchThreads = useThreadsStore((s) => s.fetchThreads);

  useEffect(() => {
    if (connected) {
      fetchThreads();
    }
  }, [connected]);

  const handleRefresh = useCallback(() => {
    if (connected) {
      fetchThreads();
    }
  }, [connected]);

  const handlePressThread = useCallback(
    (id: string) => {
      router.push(`/thread/${id}`);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: ThreadSummary }) => (
      <ThreadCard thread={item} onPress={() => handlePressThread(item.id)} />
    ),
    [handlePressThread]
  );

  const keyExtractor = useCallback((item: ThreadSummary) => item.id, []);

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
