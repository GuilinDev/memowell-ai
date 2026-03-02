import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Animated,
  Modal,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { colors } from '../../theme/colors';
import {
  getPatients,
  reportEvent,
  recordIntervention,
  listEvents,
  generateHandoff,
  acknowledgeHandoff,
} from '../../api/client';
import type { Patient, EventOut, EventReportResponse, ProtocolStep } from '../../types';

const REPORTER_ID = 1;
const SCREEN_WIDTH = Dimensions.get('window').width;

// ─── Message Types ───

type MessageType = 'user' | 'summary' | 'protocol' | 'actions' | 'notification' | 'handoff' | 'system';

interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  data?: any;
  timestamp: Date;
}

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

// ─── Components ───

function UserBubble({ content }: { content: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{content}</Text>
      </View>
    </View>
  );
}

function SummaryBubble({ content }: { content: string }) {
  return (
    <View style={styles.centeredRow}>
      <Text style={styles.summaryText}>{content}</Text>
    </View>
  );
}

function ProtocolCard({ data }: { data: ProtocolStep[] }) {
  // Filter out protocols with no actionable steps
  const hasContent = data.some(p => p.steps && p.steps.length > 0 && p.steps[0] !== '');
  if (!hasContent) return null;

  return (
    <View style={styles.protocolCard}>
      <Text style={styles.protocolTitle}>📋 Recommended Steps</Text>
      {data.map((protocol, i) => {
        // Prefer LLM-summarized steps; fall back to truncated text
        const steps = protocol.steps && protocol.steps.length > 0 && protocol.steps[0] !== ''
          ? protocol.steps
          : null;
        if (!steps) return null;
        return (
          <View key={i} style={styles.protocolGroup}>
            {steps.map((step: string, j: number) => (
              <Text key={j} style={styles.protocolStepText}>
                {j + 1}. {step}
              </Text>
            ))}
            <Text style={styles.protocolSource}>
              📎 {protocol.source || protocol.title || protocol.filename}{protocol.page ? `, p.${protocol.page}` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ActionButtons({ data, onAction }: { data: { eventId: number }; onAction: (action: string, eventId: number) => void }) {
  return (
    <View style={styles.actionsRow}>
      <TouchableOpacity style={styles.actionBtnFilled} onPress={() => onAction('confirm', data.eventId)}>
        <Text style={styles.actionBtnFilledText}>✅ Confirm & Log</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtnOutline} onPress={() => onAction('escalate', data.eventId)}>
        <Text style={styles.actionBtnOutlineText}>🚨 Escalate</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtnOutline} onPress={() => onAction('detail', data.eventId)}>
        <Text style={styles.actionBtnOutlineText}>➕ Add Detail</Text>
      </TouchableOpacity>
    </View>
  );
}

function NotificationBubble({ content }: { content: string }) {
  return (
    <View style={styles.centeredRow}>
      <Text style={styles.notificationText}>{content}</Text>
    </View>
  );
}

function HandoffCard({ data }: { data: any }) {
  return (
    <View style={styles.handoffCard}>
      <Text style={styles.handoffTitle}>📝 Shift Handoff Summary</Text>
      {data.events_summary?.map((evt: any, i: number) => (
        <View key={i} style={styles.handoffItem}>
          <Text style={styles.handoffItemText}>
            • {evt.patient_name || `Patient ${evt.patient_id}`}: {evt.event_type} ({evt.severity}) — {evt.resolved ? '✅ Resolved' : '⏳ Pending'}
          </Text>
        </View>
      ))}
      {data.pending_items?.length > 0 && (
        <>
          <Text style={[styles.handoffTitle, { marginTop: 8 }]}>⚠️ Pending Items</Text>
          {data.pending_items.map((item: any, i: number) => (
            <Text key={i} style={styles.handoffItemText}>• {typeof item === 'string' ? item : item.description || JSON.stringify(item)}</Text>
          ))}
        </>
      )}
    </View>
  );
}

function SystemBubble({ content }: { content: string }) {
  return (
    <View style={styles.centeredRow}>
      <Text style={styles.systemText}>{content}</Text>
    </View>
  );
}

// ─── Main Screen ───

export function ChatAppScreen() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const drawerAnim = useRef(new Animated.Value(-SCREEN_WIDTH * 0.8)).current;

  // Load patients on mount
  useEffect(() => {
    getPatients().then(setPatients).catch(console.error);
  }, []);

  // Drawer animation
  useEffect(() => {
    Animated.timing(drawerAnim, {
      toValue: drawerOpen ? 0 : -SCREEN_WIDTH * 0.8,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const addMessages = useCallback((newMsgs: ChatMessage[]) => {
    setMessages(prev => [...prev, ...newMsgs]);
    scrollToBottom();
  }, [scrollToBottom]);

  // Load patient history
  const selectPatient = useCallback(async (patient: Patient) => {
    setSelectedPatient(patient);
    setDrawerOpen(false);
    setMessages([]);

    try {
      const events = await listEvents(Number(patient.id));
      const historyMsgs: ChatMessage[] = [];

      // Welcome message
      historyMsgs.push({
        id: nextId(),
        type: 'system',
        content: `Now viewing ${patient.name} — ${patient.diagnosis || 'No diagnosis on file'}`,
        timestamp: new Date(),
      });

      // Convert events to chat messages
      for (const evt of events) {
        historyMsgs.push({
          id: nextId(),
          type: 'summary',
          content: `[${evt.event_type} · ${evt.severity} · ${evt.event_at || evt.created_at || ''}]`,
          data: evt,
          timestamp: new Date(evt.created_at || Date.now()),
        });
        if (evt.description) {
          historyMsgs.push({
            id: nextId(),
            type: 'system',
            content: evt.description,
            timestamp: new Date(evt.created_at || Date.now()),
          });
        }
        if (evt.intervention_description) {
          historyMsgs.push({
            id: nextId(),
            type: 'notification',
            content: `✅ Intervention: ${evt.intervention_description}`,
            timestamp: new Date(evt.intervention_at || Date.now()),
          });
        }
      }

      setMessages(historyMsgs);
      scrollToBottom();
    } catch (e) {
      console.error(e);
      setMessages([{
        id: nextId(),
        type: 'system',
        content: `Now viewing ${patient.name}. Could not load history.`,
        timestamp: new Date(),
      }]);
    }
  }, [scrollToBottom]);

  // Handle action buttons
  const handleAction = useCallback(async (action: string, eventId: number) => {
    if (action === 'confirm') {
      try {
        await recordIntervention(eventId, 'Confirmed as reported');
        addMessages([{ id: nextId(), type: 'notification', content: '✅ Event logged', timestamp: new Date() }]);
      } catch {
        addMessages([{ id: nextId(), type: 'notification', content: '❌ Failed to log event', timestamp: new Date() }]);
      }
    } else if (action === 'escalate') {
      addMessages([{ id: nextId(), type: 'notification', content: '🚨 Escalated to nurse on duty', timestamp: new Date() }]);
    } else if (action === 'detail') {
      addMessages([{ id: nextId(), type: 'system', content: 'Please provide additional details about this event:', timestamp: new Date() }]);
    }
  }, [addMessages]);

  // Send message
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !selectedPatient) return;
    setInputText('');

    // Check for handoff command
    if (text.toLowerCase().includes('generate handoff')) {
      addMessages([{ id: nextId(), type: 'user', content: text, timestamp: new Date() }]);
      setLoading(true);
      try {
        const now = new Date();
        const shift = now.getHours() < 15 ? 'day' : 'evening';
        const result = await generateHandoff(shift, REPORTER_ID, [Number(selectedPatient.id)]);
        addMessages([{
          id: nextId(),
          type: 'handoff',
          content: 'Handoff generated',
          data: result,
          timestamp: new Date(),
        }]);
      } catch {
        addMessages([{ id: nextId(), type: 'notification', content: '❌ Failed to generate handoff', timestamp: new Date() }]);
      }
      setLoading(false);
      return;
    }

    // Normal event report
    addMessages([{ id: nextId(), type: 'user', content: text, timestamp: new Date() }]);
    setLoading(true);

    try {
      const result: EventReportResponse = await reportEvent(Number(selectedPatient.id), REPORTER_ID, text);

      const newMsgs: ChatMessage[] = [];

      // Summary
      if (result.parsed) {
        const p = result.parsed;
        newMsgs.push({
          id: nextId(),
          type: 'summary',
          content: `[${p.event_type} · ${p.severity} · ${p.summary || ''}]`,
          data: result.parsed,
          timestamp: new Date(),
        });
      }

      // Check if protocols have actual steps
      const hasProtocols = result.protocols?.some(
        p => p.steps && p.steps.length > 0 && p.steps[0] !== '' && p.steps[0] !== 'No specific protocols needed. Continue monitoring.'
      );

      // Protocol card (only if real steps exist)
      if (hasProtocols) {
        newMsgs.push({
          id: nextId(),
          type: 'protocol',
          content: '',
          data: result.protocols,
          timestamp: new Date(),
        });
      }

      // Action buttons
      newMsgs.push({
        id: nextId(),
        type: 'actions',
        content: '',
        data: { eventId: result.event_id },
        timestamp: new Date(),
      });

      addMessages(newMsgs);
    } catch (e) {
      addMessages([{ id: nextId(), type: 'notification', content: '❌ Failed to report event', timestamp: new Date() }]);
    }

    setLoading(false);
  }, [inputText, selectedPatient, addMessages]);

  // Render message
  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'user': return <UserBubble content={item.content} />;
      case 'summary': return <SummaryBubble content={item.content} />;
      case 'protocol': return <ProtocolCard data={item.data} />;
      case 'actions': return <ActionButtons data={item.data} onAction={handleAction} />;
      case 'notification': return <NotificationBubble content={item.content} />;
      case 'handoff': return <HandoffCard data={item.data} />;
      case 'system': return <SystemBubble content={item.content} />;
      default: return null;
    }
  }, [handleAction]);

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.menuBtn}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={styles.titleArea}>
          <Text style={styles.titleText} numberOfLines={1}>
            {selectedPatient ? `${selectedPatient.name}` : 'Select a patient'}
          </Text>
          {selectedPatient && (
            <Text style={styles.subtitleText}>{selectedPatient.diagnosis || ''}</Text>
          )}
        </TouchableOpacity>
        <View style={styles.topBarRight}>
          {/* Settings icon placeholder */}
        </View>
      </View>

      {/* Chat Messages */}
      {!selectedPatient ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>Welcome to Memowell</Text>
          <Text style={styles.emptySubtitle}>Tap ☰ to select a patient and start reporting</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          style={styles.chatList}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Processing...</Text>
        </View>
      )}

      {/* Input Bar */}
      {selectedPatient && (
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Report an event or ask a question..."
            placeholderTextColor={colors.textLight}
            multiline
            onSubmitEditing={handleSend}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || loading}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Patient Drawer */}
      <Modal visible={drawerOpen} transparent animationType="none" onRequestClose={() => setDrawerOpen(false)}>
        <TouchableOpacity style={styles.drawerOverlay} activeOpacity={1} onPress={() => setDrawerOpen(false)}>
          <Animated.View style={[styles.drawer, { transform: [{ translateX: drawerAnim }] }]}>
            <TouchableOpacity activeOpacity={1}>
              <Text style={styles.drawerTitle}>Patients</Text>
              {patients.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.drawerItem,
                    selectedPatient?.id === p.id && styles.drawerItemActive,
                  ]}
                  onPress={() => selectPatient(p)}
                >
                  <Text style={styles.drawerItemName}>{p.name}</Text>
                  <Text style={styles.drawerItemSub}>{p.diagnosis} · Age {p.age}</Text>
                </TouchableOpacity>
              ))}
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Styles ───

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 12 : 50,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuBtn: {
    padding: 8,
  },
  menuIcon: {
    fontSize: 22,
  },
  titleArea: {
    flex: 1,
    marginLeft: 8,
  },
  titleText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  subtitleText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  topBarRight: {
    width: 40,
  },
  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Chat
  chatList: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 8,
  },
  // User bubble
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  userBubbleText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
  },
  // Summary
  centeredRow: {
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryText: {
    fontSize: 13,
    color: colors.textLight,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Protocol card
  protocolCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  protocolTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 10,
  },
  protocolGroup: {
    marginBottom: 12,
  },
  protocolStep: {
    marginBottom: 8,
  },
  protocolStepText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  protocolSource: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 2,
  },
  // Action buttons
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  actionBtnFilled: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionBtnFilledText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtnOutline: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionBtnOutlineText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  // Notification
  notificationText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  // Handoff card
  handoffCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  handoffTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  handoffItem: {
    marginBottom: 4,
  },
  handoffItemText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  // System
  systemText: {
    fontSize: 13,
    color: colors.textLight,
  },
  // Loading
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingBottom: Platform.OS === 'web' ? 12 : 34,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: colors.text,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: {
    backgroundColor: colors.textLight,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  // Drawer
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SCREEN_WIDTH * 0.8,
    maxWidth: 320,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'web' ? 20 : 60,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 20,
  },
  drawerItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  drawerItemActive: {
    backgroundColor: colors.primaryLight + '30',
  },
  drawerItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  drawerItemSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
