import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useConnectionStore } from '../../src/store/connection';
import { StatusBar } from '../../src/components/StatusBar';

export default function SettingsScreen() {
  const { baseUrl, token, status, error, connect, disconnect } =
    useConnectionStore();

  const [hostInput, setHostInput] = useState(baseUrl || '');
  const [tokenInput, setTokenInput] = useState(token || '');
  const [connecting, setConnecting] = useState(false);

  const connected = status === 'connected';

  const handleConnect = useCallback(async () => {
    const host = hostInput.trim();
    const tok = tokenInput.trim();

    if (!host) {
      Alert.alert('Error', 'Please enter the gateway address.');
      return;
    }
    if (!tok) {
      Alert.alert('Error', 'Please enter the access token.');
      return;
    }

    // Normalize: add http:// if no scheme
    let normalized = host;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `http://${normalized}`;
    }

    setConnecting(true);
    const ok = await connect(normalized, tok);
    setConnecting(false);

    if (!ok) {
      Alert.alert(
        'Connection Failed',
        'Cannot reach the gateway. Check the address and ensure the desktop app is running.'
      );
    }
  }, [hostInput, tokenInput, connect]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    setHostInput('');
    setTokenInput('');
  }, [disconnect]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <StatusBar status={status} />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Gateway Connection</Text>
          <Text style={styles.cardDescription}>
            Enter the address and token from your Kun desktop app. The gateway
            must be running and accessible on your network.
          </Text>

          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            value={hostInput}
            onChangeText={setHostInput}
            placeholder="192.168.1.100:3456"
            placeholderTextColor="#8492b1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!connected}
          />

          <Text style={styles.label}>Token</Text>
          <TextInput
            style={styles.input}
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder="Paste your access token"
            placeholderTextColor="#8492b1"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!connected}
          />

          {error ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={16} color="#d6493f" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {!connected ? (
            <TouchableOpacity
              style={[styles.button, styles.connectBtn]}
              onPress={handleConnect}
              disabled={connecting}
              activeOpacity={0.7}
            >
              {connecting ? (
                <Text style={styles.buttonText}>Connecting...</Text>
              ) : (
                <>
                  <MaterialIcons name="link" size={18} color="#fff" />
                  <Text style={styles.buttonText}>Connect</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.disconnectBtn]}
              onPress={handleDisconnect}
              activeOpacity={0.7}
            >
              <MaterialIcons name="link-off" size={18} color="#fff" />
              <Text style={styles.buttonText}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.infoCard}>
          <MaterialIcons name="info-outline" size={18} color="#54678c" />
          <Text style={styles.infoText}>
            To get started, open the Kun desktop app, enable the Mobile Gateway
            in Settings, then enter the address and token shown there.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbff',
  },
  scroll: {
    padding: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#233659',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    color: '#54678c',
    lineHeight: 19,
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#54678c',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#f3f5fc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    padding: 12,
    fontSize: 15,
    color: '#233659',
    marginBottom: 16,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(214,73,63,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#d6493f',
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
  },
  connectBtn: {
    backgroundColor: '#3b82d8',
  },
  disconnectBtn: {
    backgroundColor: '#d6493f',
  },
  buttonText: {
    marginLeft: 6,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
  },
  infoText: {
    marginLeft: 10,
    flex: 1,
    fontSize: 13,
    color: '#54678c',
    lineHeight: 19,
  },
});
