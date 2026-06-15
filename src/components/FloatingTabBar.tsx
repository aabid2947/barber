import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, palette, radius, space } from '../theme/tokens';
import { PressableScale } from './ui/PressableScale';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

const TAB_META: Record<string, { icon: FeatherName; label: string }> = {
  index: { icon: 'user', label: 'Customer' },
  dashboard: { icon: 'scissors', label: 'Barber' },
  admin: { icon: 'sliders', label: 'Admin' },
};

/** A floating, rounded tab bar — crisp white, soft-shadowed, cool accent for the active role. */
export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      <View style={[styles.bar, elevation.lg]}>
        {state.routes.map((route, index) => {
          const meta = TAB_META[route.name];
          if (!meta) return null;
          const focused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name as never);
            }
          };

          return (
            <PressableScale
              key={route.key}
              onPress={onPress}
              activeScale={0.94}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              style={[styles.item, focused && styles.itemActive]}
            >
              <Feather name={meta.icon} size={20} color={focused ? palette.white : palette.inkFaint} />
              <Text style={[styles.label, { color: focused ? palette.white : palette.inkFaint }]}>{meta.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    padding: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: palette.lineStrong,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    gap: 8,
  },
  itemActive: {
    backgroundColor: palette.accent,
  },
  label: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
