import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../../theme/colors';
import { SignaturePad } from '../../components/signature-pad';

const MOCK_EVENTS = [
  { id: '1', time: '08:15', text: 'Morning medication administered — Donepezil 10mg' },
  { id: '2', time: '10:30', text: 'Patient showed mild confusion during breakfast' },
  { id: '3', time: '14:00', text: 'Family visit — daughter stayed 1 hour, positive mood' },
];

const MOCK_ALERTS = [
  { id: 'a1', text: '⚠️ Fall risk flagged at 11:45 — patient attempted to stand unassisted' },
];

export function HandoffScreen() {
  const [signed, setSigned] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  const handleConfirmSignature = (data: string) => {
    setSignatureData(data);
  };

  const handleSubmitHandoff = async () => {
    if (!signatureData) return;
    // Mock API call
    console.log('Handoff submitted with signature:', signatureData);
    setSigned(true);
    Alert.alert('Handoff Complete', 'Shift handoff has been recorded successfully.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Shift Handoff</Text>

      {/* Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Shift Summary</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>3</Text>
            <Text style={styles.summaryLabel}>Events</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryNumber, { color: colors.warning }]}>1</Text>
            <Text style={styles.summaryLabel}>Alert</Text>
          </View>
        </View>
      </View>

      {/* Alerts */}
      {MOCK_ALERTS.map((alert) => (
        <View key={alert.id} style={styles.alertCard}>
          <Text style={styles.alertText}>{alert.text}</Text>
        </View>
      ))}

      {/* Events */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Events</Text>
        {MOCK_EVENTS.map((event) => (
          <View key={event.id} style={styles.eventRow}>
            <Text style={styles.eventTime}>{event.time}</Text>
            <Text style={styles.eventText}>{event.text}</Text>
          </View>
        ))}
      </View>

      {/* Signature */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Outgoing Caregiver Signature</Text>
        {signed ? (
          <View style={styles.signedBadge}>
            <Text style={styles.signedText}>✓ Signed</Text>
          </View>
        ) : (
          <>
            <SignaturePad onConfirm={handleConfirmSignature} />
            <TouchableOpacity
              style={[styles.submitButton, !signatureData && styles.submitDisabled]}
              onPress={handleSubmitHandoff}
              disabled={!signatureData}
            >
              <Text style={styles.submitText}>确认交接</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', gap: 24 },
  summaryItem: { alignItems: 'center' },
  summaryNumber: { fontSize: 28, fontWeight: '700', color: colors.primary },
  summaryLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  alertCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  alertText: { fontSize: 14, color: colors.text },
  eventRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventTime: { width: 52, fontSize: 13, fontWeight: '600', color: colors.primary },
  eventText: { flex: 1, fontSize: 14, color: colors.text },
  signedBadge: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  signedText: { fontSize: 18, fontWeight: '600', color: colors.success },
  submitButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
