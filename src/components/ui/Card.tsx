import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { elevation, palette, radius, space } from '../../theme/tokens';

interface CardProps {
  children: React.ReactNode;
  /** Shadow depth — kept light; the hairline border does the structural work. */
  level?: 'flat' | 'sm' | 'md' | 'lg';
  padding?: keyof typeof space | number;
  style?: StyleProp<ViewStyle>;
  /** Optional warm tint instead of plain white (e.g. accentSoft, liveTealSoft). */
  tint?: string;
  /** Override the hairline border (defaults to the warm sepia line). */
  borderColor?: string;
  /** Drop the border entirely (rare — most surfaces are line-drawn). */
  borderless?: boolean;
}

export function Card({ children, level = 'sm', padding = '2xl', style, tint, borderColor, borderless }: CardProps) {
  const pad = typeof padding === 'number' ? padding : space[padding];
  return (
    <View
      style={[
        styles.base,
        elevation[level],
        { padding: pad, backgroundColor: tint ?? palette.surface },
        borderless ? null : { borderWidth: 1, borderColor: borderColor ?? palette.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
  },
});
