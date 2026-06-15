import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { palette, radius } from '../../theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface IconCircleProps {
  name: FeatherName;
  size?: number;
  color?: string;
  bg?: string;
  style?: ViewStyle;
}

/** A rounded tile holding a thin-stroke icon — the calm leading glyph for list rows. */
export function IconCircle({ name, size = 44, color = palette.accent, bg = palette.accentSoft, style }: IconCircleProps) {
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius.md, backgroundColor: bg }, style]}>
      <Feather name={name} size={Math.round(size * 0.46)} color={color} />
    </View>
  );
}

interface AvatarProps {
  name: string;
  size?: number;
  bg?: string;
  color?: string;
}

/** Initials avatar for barbers — cool-tinted, friendly, no photography needed. */
export function Avatar({ name, size = 40, bg = palette.accentSoft, color = palette.accentInk }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius.pill, backgroundColor: bg }]}>
      <Text style={{ color, fontWeight: '800', fontSize: size * 0.4 }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
