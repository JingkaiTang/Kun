import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { ChatBlock, ToolBlock, ApprovalBlock, UserInputBlock } from '../types/api';

interface Props {
  block: ChatBlock;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
  onUserInput?: (requestId: string, answer: string) => void;
  processing?: boolean;
}

export function MessageBubble({ block, onApprove, onDeny, onUserInput, processing }: Props) {
  switch (block.kind) {
    case 'user':
      return <UserBubble block={block} />;
    case 'assistant':
      return <AssistantBubble block={block} />;
    case 'reasoning':
      return <ReasoningBubble block={block} />;
    case 'tool':
      return <ToolBubble block={block} />;
    case 'approval':
      return <ApprovalBubble block={block} onApprove={onApprove} onDeny={onDeny} processing={processing} />;
    case 'user_input':
      return <UserInputBubble block={block} onUserInput={onUserInput} processing={processing} />;
    case 'system':
      return <SystemBubble block={block} />;
    case 'error':
      return <ErrorBubble block={block} />;
    case 'compaction':
      return <CompactionBubble block={block} />;
    default:
      return null;
  }
}

// ---- User message ----

function UserBubble({ block }: { block: ChatBlock & { kind: 'user' } }) {
  return (
    <View style={styles.rowRight}>
      <View style={[styles.bubble, styles.userBubble]}>
        <Text style={styles.userText}>{block.text}</Text>
      </View>
      {block.modelLabel ? (
        <Text style={styles.modelLabel}>{block.modelLabel}</Text>
      ) : null}
    </View>
  );
}

// ---- Assistant message ----

function AssistantBubble({ block }: { block: ChatBlock & { kind: 'assistant' } }) {
  return (
    <View style={styles.rowLeft}>
      <View style={[styles.bubble, styles.assistantBubble]}>
        <Text style={styles.assistantText} selectable>{block.text}</Text>
      </View>
    </View>
  );
}

// ---- Reasoning (thinking) ----

function ReasoningBubble({ block }: { block: ChatBlock & { kind: 'reasoning' } }) {
  const [expanded, setExpanded] = useState(false);
  const preview = block.text.length > 100 ? block.text.slice(0, 100) + '...' : block.text;

  return (
    <View style={styles.rowLeft}>
      <TouchableOpacity
        style={[styles.bubble, styles.reasoningBubble]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.reasoningHeader}>
          <MaterialIcons name="psychology" size={14} color="#7a68e8" />
          <Text style={styles.reasoningLabel}>Thinking</Text>
          <MaterialIcons
            name={expanded ? 'expand-less' : 'expand-more'}
            size={16}
            color="#7a68e8"
          />
        </View>
        <Text style={styles.reasoningText} numberOfLines={expanded ? undefined : 3}>
          {expanded ? block.text : preview}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---- Tool call ----

function ToolBubble({ block }: { block: ToolBlock }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';
  const isSuccess = block.status === 'success';

  return (
    <View style={styles.rowLeft}>
      <TouchableOpacity
        style={[
          styles.bubble,
          styles.toolBubble,
          isError && styles.toolErrorBubble,
        ]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.toolHeader}>
          {isRunning ? (
            <ActivityIndicator size="small" color="#7a68e8" />
          ) : (
            <MaterialIcons
              name={isError ? 'error-outline' : 'check-circle-outline'}
              size={14}
              color={isError ? '#d6493f' : '#128a4a'}
            />
          )}
          <Text style={[styles.toolName, isError && styles.toolErrorName]}>
            {block.toolName || 'Tool'}
          </Text>
          {block.detail ? (
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={16}
              color="#7a68e8"
            />
          ) : null}
        </View>
        <Text style={styles.toolSummary}>{block.summary}</Text>
        {expanded && block.detail ? (
          <Text style={styles.toolDetail} selectable>{block.detail}</Text>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

// ---- Approval ----

function ApprovalBubble({
  block,
  onApprove,
  onDeny,
  processing,
}: {
  block: ApprovalBlock;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
  processing?: boolean;
}) {
  const isPending = block.status === 'pending';
  const isSubmitting = block.status === 'submitting';
  const isDone = block.status === 'allowed' || block.status === 'denied';

  const statusLabel =
    block.status === 'allowed'
      ? 'Approved'
      : block.status === 'denied'
        ? 'Denied'
        : block.status === 'error'
          ? 'Failed'
          : isSubmitting
            ? 'Submitting...'
            : 'Pending';

  return (
    <View style={[styles.bubble, styles.approvalBubble]}>
      <View style={styles.approvalHeader}>
        <MaterialIcons name="gavel" size={16} color="#e5a50b" />
        <Text style={styles.approvalTitle}>Approval Required</Text>
      </View>
      {block.toolName ? (
        <Text style={styles.approvalTool}>Tool: {block.toolName}</Text>
      ) : null}
      <Text style={styles.approvalSummary}>{block.summary}</Text>
      {block.errorMessage ? (
        <Text style={styles.approvalError}>{block.errorMessage}</Text>
      ) : null}
      {isPending || isSubmitting ? (
        <View style={styles.approvalActions}>
          <TouchableOpacity
            style={[styles.approvalBtn, styles.approveBtn]}
            onPress={() => onApprove?.(block.approvalId)}
            disabled={isSubmitting || processing}
            activeOpacity={0.7}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="check" size={16} color="#fff" />
                <Text style={styles.approveBtnText}>Allow</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.approvalBtn, styles.denyBtn]}
            onPress={() => onDeny?.(block.approvalId)}
            disabled={isSubmitting || processing}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={16} color="#fff" />
            <Text style={styles.denyBtnText}>Deny</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.approvalStatus}>{statusLabel}</Text>
      )}
    </View>
  );
}

// ---- User Input ----

function UserInputBubble({
  block,
  onUserInput,
  processing,
}: {
  block: UserInputBlock;
  onUserInput?: (requestId: string, answer: string) => void;
  processing?: boolean;
}) {
  const [text, setText] = useState('');
  const isPending = block.status === 'pending';

  if (!isPending) {
    return (
      <View style={[styles.bubble, styles.userInputBubble]}>
        <View style={styles.userInputHeader}>
          <MaterialIcons name="input" size={16} color="#7a68e8" />
          <Text style={styles.userInputTitle}>Input Provided</Text>
        </View>
        <Text style={styles.userInputPrompt}>{block.prompt}</Text>
        {block.answer ? (
          <Text style={styles.userInputAnswer}>Answer: {block.answer}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.bubble, styles.userInputBubble]}>
      <View style={styles.userInputHeader}>
        <MaterialIcons name="input" size={16} color="#7a68e8" />
        <Text style={styles.userInputTitle}>Input Required</Text>
      </View>
      <Text style={styles.userInputPrompt}>{block.prompt}</Text>
      {block.options && block.options.length > 0 ? (
        <View style={styles.userInputOptions}>
          {block.options.map((opt, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.userInputOptionBtn}
              onPress={() => onUserInput?.(block.requestId, opt)}
              disabled={processing}
              activeOpacity={0.7}
            >
              <Text style={styles.userInputOptionText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <Text style={styles.userInputHint}>Reply in the composer below</Text>
      )}
    </View>
  );
}

// ---- System ----

function SystemBubble({ block }: { block: ChatBlock & { kind: 'system' } }) {
  return (
    <View style={styles.systemContainer}>
      <Text style={styles.systemText}>{block.text}</Text>
    </View>
  );
}

// ---- Error ----

function ErrorBubble({ block }: { block: ChatBlock & { kind: 'error' } }) {
  return (
    <View style={[styles.bubble, styles.errorBubble]}>
      <View style={styles.errorHeader}>
        <MaterialIcons name="error-outline" size={14} color="#d6493f" />
        <Text style={styles.errorTitle}>Error</Text>
      </View>
      <Text style={styles.errorText}>{block.text}</Text>
    </View>
  );
}

// ---- Compaction ----

function CompactionBubble({ block }: { block: ChatBlock & { kind: 'compaction' } }) {
  return (
    <View style={styles.compactionContainer}>
      <Text style={styles.compactionText}>{block.summary}</Text>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  rowRight: {
    alignItems: 'flex-end',
    marginVertical: 3,
    marginHorizontal: 16,
  },
  rowLeft: {
    alignItems: 'flex-start',
    marginVertical: 3,
    marginHorizontal: 16,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // User
  userBubble: {
    backgroundColor: '#3b82d8',
    borderBottomRightRadius: 4,
  },
  userText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#fff',
  },
  modelLabel: {
    fontSize: 11,
    color: '#8492b1',
    marginTop: 4,
    marginRight: 4,
  },
  // Assistant
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.1)',
    borderBottomLeftRadius: 4,
  },
  assistantText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#233659',
  },
  // Reasoning
  reasoningBubble: {
    backgroundColor: 'rgba(122,104,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.2)',
    borderBottomLeftRadius: 4,
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  reasoningLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7a68e8',
  },
  reasoningText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#54678c',
  },
  // Tool
  toolBubble: {
    backgroundColor: 'rgba(122,104,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.2)',
    borderBottomLeftRadius: 4,
  },
  toolErrorBubble: {
    backgroundColor: 'rgba(214,73,63,0.08)',
    borderColor: 'rgba(214,73,63,0.2)',
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  toolName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a68e8',
  },
  toolErrorName: {
    color: '#d6493f',
  },
  toolSummary: {
    fontSize: 13,
    lineHeight: 19,
    color: '#54678c',
  },
  toolDetail: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: '#8492b1',
    fontFamily: 'monospace',
  },
  // Approval
  approvalBubble: {
    backgroundColor: 'rgba(255,248,225,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(229,165,11,0.3)',
    maxWidth: '90%',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginVertical: 3,
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  approvalTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e5a50b',
    textTransform: 'uppercase',
  },
  approvalTool: {
    fontSize: 12,
    color: '#8492b1',
    marginBottom: 4,
  },
  approvalSummary: {
    fontSize: 14,
    lineHeight: 20,
    color: '#233659',
  },
  approvalError: {
    marginTop: 6,
    fontSize: 12,
    color: '#d6493f',
  },
  approvalActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  approvalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 4,
  },
  approveBtn: {
    backgroundColor: '#128a4a',
  },
  denyBtn: {
    backgroundColor: '#d6493f',
  },
  approveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  denyBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  approvalStatus: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#8492b1',
  },
  // User Input
  userInputBubble: {
    backgroundColor: 'rgba(243,241,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.3)',
    maxWidth: '90%',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginVertical: 3,
  },
  userInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  userInputTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a68e8',
    textTransform: 'uppercase',
  },
  userInputPrompt: {
    fontSize: 14,
    lineHeight: 20,
    color: '#233659',
  },
  userInputAnswer: {
    marginTop: 6,
    fontSize: 13,
    color: '#54678c',
    fontStyle: 'italic',
  },
  userInputOptions: {
    marginTop: 10,
    gap: 8,
  },
  userInputOptionBtn: {
    backgroundColor: '#7a68e8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  userInputOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  userInputHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#8492b1',
    fontStyle: 'italic',
  },
  // System
  systemContainer: {
    alignItems: 'center',
    marginVertical: 6,
    marginHorizontal: 16,
  },
  systemText: {
    fontSize: 11,
    color: '#8492b1',
    fontStyle: 'italic',
  },
  // Error
  errorBubble: {
    backgroundColor: 'rgba(214,73,63,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(214,73,63,0.25)',
    borderBottomLeftRadius: 4,
    maxWidth: '90%',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginVertical: 3,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d6493f',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#d6493f',
  },
  // Compaction
  compactionContainer: {
    alignItems: 'center',
    marginVertical: 6,
    marginHorizontal: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(20,47,95,0.04)',
    borderRadius: 12,
  },
  compactionText: {
    fontSize: 12,
    color: '#8492b1',
  },
});
