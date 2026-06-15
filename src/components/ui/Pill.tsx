import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { palette, radius, space } from '../../theme/tokens';

export type Tone = 'neutral' | 'accent' | 'teal' | 'amber' | 'rose' | 'green';

const TONES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: palette.surfaceMuted, fg: palette.inkMuted, dot: palette.inkFaint },
  accent: { bg: palette.accentSoft, fg: palette.accentInk, dot: palette.accent },
  teal: { bg: palette.liveTealSoft, fg: palette.liveTeal, dot: palette.liveTeal },
  amber: { bg: palette.warnAmberSoft, fg: palette.warnAmber, dot: palette.warnAmber },
  rose: { bg: palette.dangerRoseSoft, fg: palette.dangerRose, dot: palette.dangerRose },
  green: { bg: palette.okGreenSoft, fg: palette.okGreen, dot: palette.okGreen },
};

interface PillProps {
  label: string;
  tone?: Tone;
  dot?: boolean;
  style?: ViewStyle;
}

/** A soft, high-contrast status chip — tone carries meaning, low visual noise. */
export function Pill({ label, tone = 'neutral', dot = false, style }: PillProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, style]}>
      {dot && <View style={[styles.dot, { backgroundColor: t.dot }]} />}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    height: 28,
    borderRadius: radius.pill,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    marginRight: 6,
  },
  text: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
