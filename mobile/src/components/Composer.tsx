import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  /** Triggered when sending while not busy. */
  onSend: () => void;
  /** Triggered when sending while busy (queues a follow-up / steer). */
  onSteer?: (text: string) => void;
  /** Triggered when the user taps Stop while busy. */
  onInterrupt?: () => void;
  /** True while the agent is producing a turn. */
  busy: boolean;
  /** True while a network send is in flight (prevents double-send). */
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChangeText,
  onSend,
  onSteer,
  onInterrupt,
  busy,
  sending = false,
  disabled = false,
  placeholder = 'Send a message...',
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [inputHeight, setInputHeight] = useState(40);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || sending || disabled) return;
    if (busy) {
      onSteer?.(text);
    } else {
      onSend();
    }
  }, [value, sending, disabled, busy, onSend, onSteer]);

  const canSend = value.trim() && !sending && !disabled;

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        {busy ? (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={onInterrupt}
            disabled={!onInterrupt}
            activeOpacity={0.7}
          >
            <MaterialIcons name="stop" size={22} color="#fff" />
          </TouchableOpacity>
        ) : null}
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            { height: Math.min(Math.max(40, inputHeight), 120) },
            busy && styles.inputBusy,
          ]}
          value={value}
          onChangeText={onChangeText}
          onContentSizeChange={(e) => {
            setInputHeight(e.nativeEvent.contentSize.height);
          }}
          placeholder={busy ? 'Add a follow-up...' : placeholder}
          placeholderTextColor="#8492b1"
          multiline
          maxLength={8000}
          editable={!sending && !disabled}
          textAlignVertical="top"
        />
        <TouchableOpacity
          style={[styles.sendButton, canSend && styles.sendButtonActive]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.7}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons
              name={busy ? 'add' : 'send'}
              size={20}
              color={canSend ? '#fff' : '#8492b1'}
            />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
    backgroundColor: '#f3f5fc',
    borderTopWidth: 1,
    borderTopColor: 'rgba(20,47,95,0.1)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  stopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#d6493f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#233659',
    lineHeight: 20,
  },
  inputBusy: {
    borderColor: 'rgba(122,104,232,0.4)',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(20,47,95,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#3b82d8',
  },
});
