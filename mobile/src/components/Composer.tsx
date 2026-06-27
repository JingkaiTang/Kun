import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChangeText,
  onSend,
  sending,
  disabled = false,
  placeholder = 'Send a message...',
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [inputHeight, setInputHeight] = useState(40);

  const handleSend = useCallback(() => {
    if (value.trim() && !sending && !disabled) {
      onSend();
    }
  }, [value, sending, disabled, onSend]);

  const canSend = value.trim() && !sending && !disabled;

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { height: Math.min(Math.max(40, inputHeight), 120) }]}
          value={value}
          onChangeText={onChangeText}
          onContentSizeChange={(e) => {
            setInputHeight(e.nativeEvent.contentSize.height);
          }}
          placeholder={placeholder}
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
              name="send"
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
