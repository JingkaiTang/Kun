import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { useConnectionStore } from '../src/store/connection';

export default function RootLayout() {
  const loadSaved = useConnectionStore((s) => s.loadSaved);

  useEffect(() => {
    loadSaved();
  }, []);

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#f3f5fc' },
          headerTintColor: '#233659',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#fafbff' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="thread/[id]"
          options={{
            title: 'Thread',
            headerBackTitle: 'Back',
          }}
        />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f5fc',
  },
});
