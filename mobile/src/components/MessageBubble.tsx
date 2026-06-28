import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  ChatBlock,
  ToolBlock,
  ApprovalBlock,
  UserInputBlock,
  UserInputAnswer,
} from '../agent/types';

interface Props {
  block: ChatBlock;
  /** Per-block approval status from the store (overrides the block's own status). */
  approvalStatus?: 'pending' | 'submitting' | 'allowed' | 'denied' | 'error';
  /** Per-block user-input status from the store. */
  userInputStatus?: 'pending' | 'submitting' | 'submitted' | 'cancelled' | 'error';
  onApprove?: (blockId: string) => void;
  onDeny?: (blockId: string) => void;
  onSubmitUserInput?: (blockId: string, answers: UserInputAnswer[]) => void;
  onCancelUserInput?: (blockId: string) => void;
}

export function MessageBubble({
  block,
  approvalStatus,
  userInputStatus,
  onApprove,
  onDeny,
  onSubmitUserInput,
  onCancelUserInput,
}: Props) {
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
      return (
        <ApprovalBubble
          block={block}
          status={approvalStatus ?? block.status}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );
    case 'user_input':
      return (
        <UserInputBubble
          block={block}
          status={userInputStatus ?? block.status}
          onSubmit={onSubmitUserInput}
          onCancel={onCancelUserInput}
        />
      );
    case 'system':
      return <SystemBubble block={block} />;
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
  const toolName =
    (block.meta?.toolName as string | undefined) ||
    (typeof block.summary === 'string' ? block.summary.split('\n')[0] : 'Tool');

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
            {toolName}
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
  status,
  onApprove,
  onDeny,
}: {
  block: ApprovalBlock;
  status: 'pending' | 'submitting' | 'allowed' | 'denied' | 'error';
  onApprove?: (blockId: string) => void;
  onDeny?: (blockId: string) => void;
}) {
  const isPending = status === 'pending';
  const isSubmitting = status === 'submitting';

  const statusLabel =
    status === 'allowed'
      ? 'Approved'
      : status === 'denied'
        ? 'Denied'
        : status === 'error'
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
            onPress={() => onApprove?.(block.id)}
            disabled={isSubmitting}
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
            onPress={() => onDeny?.(block.id)}
            disabled={isSubmitting}
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
  status,
  onSubmit,
  onCancel,
}: {
  block: UserInputBlock;
  status: 'pending' | 'submitting' | 'submitted' | 'cancelled' | 'error';
  onSubmit?: (blockId: string, answers: UserInputAnswer[]) => void;
  onCancel?: (blockId: string) => void;
}) {
  const [textByQuestion, setTextByQuestion] = useState<Record<string, string>>({});
  const isPending = status === 'pending';
  const isSubmitting = status === 'submitting';

  if (!isPending && !isSubmitting) {
    const statusLabel =
      status === 'submitted'
        ? 'Submitted'
        : status === 'cancelled'
          ? 'Cancelled'
          : 'Failed';
    return (
      <View style={[styles.bubble, styles.userInputBubble]}>
        <View style={styles.userInputHeader}>
          <MaterialIcons name="input" size={16} color="#7a68e8" />
          <Text style={styles.userInputTitle}>{statusLabel}</Text>
        </View>
        {block.answers && block.answers.length > 0 ? (
          block.answers.map((answer, idx) => {
            const question = block.questions.find((q) => q.id === answer.id);
            return (
              <View key={idx} style={styles.userInputAnswerRow}>
                <Text style={styles.userInputAnswerLabel}>
                  {question?.header ?? answer.id}: {answer.label}
                </Text>
              </View>
            );
          })
        ) : null}
        {block.errorMessage ? (
          <Text style={styles.userInputError}>{block.errorMessage}</Text>
        ) : null}
      </View>
    );
  }

  const hasMultipleChoice = block.questions.some(
    (q) => q.options && q.options.length > 0
  );

  const submitAll = (): void => {
    const answers: UserInputAnswer[] = block.questions.map((q) => {
      const text = textByQuestion[q.id]?.trim();
      if (text && q.options.length > 0) {
        const matched = q.options.find((o) => o.label === text);
        if (matched) {
          return { id: q.id, label: matched.label, value: text };
        }
      }
      return {
        id: q.id,
        label: text || q.options[0]?.label || q.question,
        value: text || q.options[0]?.label || '',
      };
    });
    onSubmit?.(block.id, answers);
  };

  return (
    <View style={[styles.bubble, styles.userInputBubble]}>
      <View style={styles.userInputHeader}>
        <MaterialIcons name="input" size={16} color="#7a68e8" />
        <Text style={styles.userInputTitle}>Input Required</Text>
      </View>
      {block.questions.map((q, qIdx) => (
        <View key={q.id} style={qIdx > 0 ? styles.userInputQuestionGap : null}>
          <Text style={styles.userInputQuestionHeader}>{q.header}</Text>
          <Text style={styles.userInputPrompt}>{q.question}</Text>
          {q.options && q.options.length > 0 ? (
            <View style={styles.userInputOptions}>
              {q.options.map((opt, optIdx) => {
                const selected = textByQuestion[q.id] === opt.label;
                return (
                  <TouchableOpacity
                    key={optIdx}
                    style={[
                      styles.userInputOptionBtn,
                      selected && styles.userInputOptionBtnSelected,
                    ]}
                    onPress={() =>
                      setTextByQuestion((prev) => ({ ...prev, [q.id]: opt.label }))
                    }
                    disabled={isSubmitting}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.userInputOptionText}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <TextInput
              style={styles.userInputText}
              value={textByQuestion[q.id] ?? ''}
              onChangeText={(text) =>
                setTextByQuestion((prev) => ({ ...prev, [q.id]: text }))
              }
              placeholder="Type your answer..."
              placeholderTextColor="#8492b1"
              editable={!isSubmitting}
              multiline
            />
          )}
        </View>
      ))}
      <View style={styles.userInputActions}>
        {hasMultipleChoice ? null : (
          <TouchableOpacity
            style={[styles.userInputBtn, styles.userInputCancelBtn]}
            onPress={() => onCancel?.(block.id)}
            disabled={isSubmitting}
            activeOpacity={0.7}
          >
            <Text style={styles.userInputCancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.userInputBtn, styles.userInputSubmitBtn]}
          onPress={submitAll}
          disabled={isSubmitting}
          activeOpacity={0.7}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.userInputSubmitText}>Submit</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---- System ----

function SystemBubble({ block }: { block: ChatBlock & { kind: 'system' } }) {
  const isError = block.severity === 'error';
  const isWarning = block.severity === 'warning';
  return (
    <View style={[
      styles.bubble,
      styles.systemBubble,
      isError && styles.systemErrorBubble,
      isWarning && styles.systemWarningBubble,
    ]}>
      <View style={styles.systemHeader}>
        <MaterialIcons
          name={isError ? 'error-outline' : isWarning ? 'warning' : 'info'}
          size={14}
          color={isError ? '#d6493f' : isWarning ? '#e5a50b' : '#7a68e8'}
        />
        <Text style={[
          styles.systemTitle,
          isError && styles.systemErrorTitle,
          isWarning && styles.systemWarningTitle,
        ]}>
          {block.code ? block.code : isError ? 'Error' : isWarning ? 'Warning' : 'Notice'}
        </Text>
      </View>
      <Text style={styles.systemText}>{block.text}</Text>
      {block.detail ? (
        <Text style={styles.systemDetail} selectable>{block.detail}</Text>
      ) : null}
    </View>
  );
}

// ---- Compaction ----

function CompactionBubble({ block }: { block: ChatBlock & { kind: 'compaction' } }) {
  return (
    <View style={styles.compactionContainer}>
      <MaterialIcons name="compress" size={14} color="#8492b1" />
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
    color: '#8492b1',
    fontStyle: 'italic',
  },
  // User input
  userInputBubble: {
    backgroundColor: 'rgba(122,104,232,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.2)',
    maxWidth: '90%',
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginVertical: 3,
  },
  userInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  userInputTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a68e8',
    textTransform: 'uppercase',
  },
  userInputQuestionGap: {
    marginTop: 12,
  },
  userInputQuestionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7a68e8',
    marginBottom: 4,
  },
  userInputPrompt: {
    fontSize: 14,
    lineHeight: 20,
    color: '#233659',
    marginBottom: 8,
  },
  userInputOptions: {
    flexDirection: 'column',
    gap: 6,
  },
  userInputOptionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.12)',
  },
  userInputOptionBtnSelected: {
    backgroundColor: 'rgba(122,104,232,0.15)',
    borderColor: '#7a68e8',
  },
  userInputOptionText: {
    fontSize: 14,
    color: '#233659',
  },
  userInputText: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(20,47,95,0.12)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#233659',
    minHeight: 40,
    maxHeight: 100,
  },
  userInputActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  userInputBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  userInputCancelBtn: {
    backgroundColor: 'rgba(20,47,95,0.08)',
  },
  userInputCancelText: {
    fontSize: 14,
    color: '#54678c',
  },
  userInputSubmitBtn: {
    backgroundColor: '#7a68e8',
  },
  userInputSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  userInputAnswerRow: {
    marginTop: 6,
  },
  userInputAnswerLabel: {
    fontSize: 13,
    color: '#54678c',
  },
  userInputError: {
    marginTop: 6,
    fontSize: 12,
    color: '#d6493f',
  },
  // System
  systemBubble: {
    backgroundColor: 'rgba(122,104,232,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(122,104,232,0.2)',
    alignSelf: 'center',
    marginHorizontal: 16,
    marginVertical: 4,
  },
  systemErrorBubble: {
    backgroundColor: 'rgba(214,73,63,0.08)',
    borderColor: 'rgba(214,73,63,0.25)',
  },
  systemWarningBubble: {
    backgroundColor: 'rgba(229,165,11,0.08)',
    borderColor: 'rgba(229,165,11,0.25)',
  },
  systemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  systemTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a68e8',
    textTransform: 'uppercase',
  },
  systemErrorTitle: {
    color: '#d6493f',
  },
  systemWarningTitle: {
    color: '#e5a50b',
  },
  systemText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#233659',
  },
  systemDetail: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
    color: '#8492b1',
    fontFamily: 'monospace',
  },
  // Compaction
  compactionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(20,47,95,0.04)',
    marginHorizontal: 16,
    marginVertical: 4,
  },
  compactionText: {
    fontSize: 11,
    color: '#8492b1',
    fontStyle: 'italic',
  },
});
