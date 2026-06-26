import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { UserInputRequest } from '../types/api';

interface Props {
  request: UserInputRequest;
  onSubmit: (answer: string) => void;
  processing?: boolean;
}

export function UserInputCard({ request, onSubmit, processing }: Props) {
  const [text, setText] = useState('');

  const handleSubmit = (value: string) => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="input" size={18} color="#7a68e8" />
        <Text style={styles.label}>Input Required</Text>
      </View>
      <Text style={styles.prompt}>{request.prompt}</Text>

      {request.options && request.options.length > 0 ? (
        <View style={styles.options}>
          {request.options.map((opt, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.optionBtn}
              onPress={() => handleSubmit(opt)}
              disabled={processing}
              activeOpacity={0.7}
            >
              <Text style={styles.optionText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.textRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type your answer..."
            placeholderTextColor="#8492b1"
            editable={!processing}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={() => handleSubmit(text)}
            disabled={!text.trim() || !!processing}
            activeOpacity={0.7}
          >
            <MaterialIcons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(243,241,255,0.95)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#7a68e8',
    textTransform: 'uppercase',
  },
  prompt: {
    fontSize: 14,
    color: '#233659',
    lineHeight: 20,
    marginBottom: 10,
  },
  options: {
    gap: 8,
  },
  optionBtn: {
    backgroundColor: '#7a68e8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.13)',
    padding: 10,
    fontSize: 14,
    color: '#233659',
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7a68e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
