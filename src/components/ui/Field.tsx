import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { palette, radius, space, type } from '../../theme/tokens';
import { PressableScale } from './PressableScale';

interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  style?: ViewStyle;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'sentences',
  maxLength,
  style,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      {label ? <Text style={[type.label, styles.label]}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkFaint}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={palette.accent}
      />
    </View>
  );
}

interface StepperProps {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  /** Show an OFF state when value hits `offValue` (used by the waiting timer). */
  offValue?: number;
}

export function Stepper({ label, value, onChange, min = 1, max = 10, suffix, offValue }: StepperProps) {
  const isOff = offValue !== undefined && value === offValue;
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <View>
      {label ? <Text style={[type.label, styles.label]}>{label}</Text> : null}
      <View style={styles.stepper}>
        <PressableScale onPress={dec} style={styles.stepBtn} accessibilityLabel="decrease">
          <Feather name="minus" size={18} color={palette.accentInk} />
        </PressableScale>
        <Text style={styles.stepValue}>{isOff ? 'Off' : `${value}${suffix ?? ''}`}</Text>
        <PressableScale onPress={inc} style={styles.stepBtn} accessibilityLabel="increase">
          <Feather name="plus" size={18} color={palette.accentInk} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 8 },
  input: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1.5,
    borderColor: palette.line,
    paddingHorizontal: space.lg,
    fontSize: 16,
    fontWeight: '500',
    color: palette.ink,
  },
  inputFocused: {
    borderColor: palette.accent,
    backgroundColor: palette.surface,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.line,
    padding: 6,
  },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.ink,
    fontVariant: ['tabular-nums'],
  },
});
