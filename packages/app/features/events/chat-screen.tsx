import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'solito/router';
import { colors } from '../../theme/colors';
import type { ChatMessage } from '../../types';
import { sendMessage, endSession, getBaseUrl } from '../../api/client';
import { MessageBubble } from '../../components/message-bubble';
import { VoiceButton } from '../../components/voice-button';

interface Props {
  sessionId: string;
  patientName: string;
}

export function ChatScreen({ sessionId, patientName }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const baseUrl = getBaseUrl();

  const handleSend = async (text?: string) => {
    const msg = text ?? input.trim();
    if (!msg) return;
    setSending(true);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: msg,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      const res = await sendMessage(sessionId, msg);
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.response,
        audioUrl: res.audio_url ? `${baseUrl}${res.audio_url}` : undefined,
        imageUrl: res.image_url || undefined,
        monitor: res.monitor,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to send message'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  const handleEndSession = async () => {
    try {
      await endSession(sessionId);
    } finally {
      router.back();
    }
  };

  const latestEmotion = messages
    .filter((m) => m.role === 'assistant' && m.monitor)
    .slice(-1)[0]?.monitor?.emotion;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{patientName}</Text>
        <TouchableOpacity onPress={handleEndSession}>
          <Text style={styles.endButton}>End</Text>
        </TouchableOpacity>
      </View>

      {latestEmotion && (
        <View style={styles.emotionBar}>
          <View
            style={[
              styles.emotionIndicator,
              { backgroundColor: (colors as any)[latestEmotion] || colors.textLight },
            ]}
          />
          <Text style={styles.emotionText}>{latestEmotion}</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} baseUrl={baseUrl} />}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputBar}>
        <View style={styles.textInputWrapper}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor={colors.textLight}
            multiline
            editable={!sending}
            onSubmitEditing={() => handleSend()}
          />
          <VoiceButton onRecordingComplete={() => {}} disabled={sending} />
        </View>
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
          onPress={() => handleSend()}
          disabled={!input.trim() || sending}
          activeOpacity={0.7}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  endButton: { color: colors.error, fontSize: 16, fontWeight: '600' },
  emotionBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  emotionIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  emotionText: { fontSize: 14, color: colors.textSecondary, textTransform: 'capitalize' },
  messageList: { paddingVertical: 12 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: 8,
  },
  textInputWrapper: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 24, paddingRight: 6,
  },
  textInput: {
    flex: 1, minHeight: 48, maxHeight: 120,
    paddingHorizontal: 18, paddingVertical: 12, fontSize: 17, color: colors.text,
  },
  sendButton: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendIcon: { color: '#FFF', fontSize: 20 },
});
