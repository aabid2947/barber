import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { elevation, hit, palette, radius, space } from '../../theme/tokens';
import { PressableScale } from './PressableScale';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'tealSolid';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: Size;
  icon?: FeatherName;
  iconRight?: FeatherName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<
  ButtonVariant,
  { bg: string; fg: string; border?: string; shadow?: 'sm' | 'md' }
> = {
  primary: { bg: palette.accent, fg: palette.white, shadow: 'md' },
  tealSolid: { bg: palette.liveTeal, fg: palette.white, shadow: 'md' },
  success: { bg: palette.okGreen, fg: palette.white, shadow: 'sm' },
  secondary: { bg: palette.surface, fg: palette.ink, border: palette.lineStrong, shadow: 'sm' },
  ghost: { bg: 'transparent', fg: palette.accentInk },
  danger: { bg: palette.dangerRoseSoft, fg: palette.dangerRose },
};

const SIZES: Record<Size, { height: number; font: number; padH: number; radius: number; icon: number }> = {
  sm: { height: hit.chip, font: 14, padH: space.lg, radius: radius.md, icon: 17 },
  md: { height: hit.control, font: 15.5, padH: space.xl, radius: radius.lg, icon: 19 },
  lg: { height: hit.controlLg, font: 16.5, padH: space['2xl'], radius: radius.lg, icon: 20 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const isDisabled = disabled || loading;

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        v.shadow ? elevation[v.shadow] : null,
        {
          height: s.height,
          paddingHorizontal: s.padH,
          borderRadius: s.radius,
          backgroundColor: v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          width: fullWidth ? '100%' : undefined,
          opacity: isDisabled ? 0.55 : 1,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={v.fg} />
        ) : (
          <>
            {icon && <Feather name={icon} size={s.icon} color={v.fg} style={styles.iconL} />}
            <Text style={[styles.label, { color: v.fg, fontSize: s.font }]}>{label}</Text>
            {iconRight && <Feather name={iconRight} size={s.icon} color={v.fg} style={styles.iconR} />}
          </>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iconL: { marginRight: space.sm },
  iconR: { marginLeft: space.sm },
});
