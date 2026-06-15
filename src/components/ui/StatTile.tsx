import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { elevation, palette, radius, space, type } from '../../theme/tokens';

interface StatTileProps {
  value: number | string;
  label: string;
  tone?: 'ink' | 'accent' | 'teal' | 'amber';
}

const COLORS = {
  ink: palette.ink,
  accent: palette.accent,
  teal: palette.liveTeal,
  amber: palette.warnAmber,
};

/** Compact white metric tile — big numeral, muted label, soft lift. */
export function StatTile({ value, label, tone = 'ink' }: StatTileProps) {
  return (
    <View style={[styles.tile, elevation.sm]}>
      <Text style={[styles.value, { color: COLORS[tone] }]}>{value}</Text>
      <Text style={[type.label, styles.label]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
    alignItems: 'center',
  },
  value: {
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  label: {
    marginTop: 6,
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
});
