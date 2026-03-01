import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { colors } from '../theme/colors';

interface Props {
  onRecordingComplete: (uri: string) => void;
  disabled?: boolean;
}

/**
 * VoiceButton — compact 32px mic icon for inline use inside TextInput.
 * On native, integrate expo-av Recording.
 * On web, integrate MediaRecorder API.
 */
export function VoiceButton({ onRecordingComplete, disabled }: Props) {
  const handlePress = () => {
    if (Platform.OS === 'web') {
      console.warn('Voice recording not yet implemented for web');
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>🎤</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  icon: { fontSize: 18, color: colors.textLight },
});
