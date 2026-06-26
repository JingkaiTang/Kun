import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { Approval } from '../types/api';

interface Props {
  approval: Approval;
  onApprove: () => void;
  onDeny: () => void;
  processing?: boolean;
}

export function ApprovalCard({ approval, onApprove, onDeny, processing }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="gavel" size={18} color="#e5a50b" />
        <Text style={styles.kind}>{approval.kind}</Text>
      </View>
      <Text style={styles.summary}>{approval.summary}</Text>
      {approval.detail ? (
        <Text style={styles.detail} numberOfLines={4}>
          {approval.detail}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.approveBtn]}
          onPress={onApprove}
          disabled={processing}
          activeOpacity={0.7}
        >
          <MaterialIcons name="check" size={16} color="#fff" />
          <Text style={styles.approveText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.denyBtn]}
          onPress={onDeny}
          disabled={processing}
          activeOpacity={0.7}
        >
          <MaterialIcons name="close" size={16} color="#fff" />
          <Text style={styles.denyText}>Deny</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,248,225,0.95)',
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(229,165,11,0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  kind: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#e5a50b',
    textTransform: 'uppercase',
  },
  summary: {
    fontSize: 14,
    color: '#233659',
    lineHeight: 20,
  },
  detail: {
    marginTop: 6,
    fontSize: 12,
    color: '#54678c',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveBtn: {
    backgroundColor: '#128a4a',
  },
  denyBtn: {
    backgroundColor: '#d6493f',
  },
  approveText: {
    marginLeft: 4,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  denyText: {
    marginLeft: 4,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
