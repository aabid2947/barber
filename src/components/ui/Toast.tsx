import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, palette, radius, space } from '../../theme/tokens';

export function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, showToast };
}

/** A quiet floating confirmation banner pinned below the status bar. */
export function Toast({ message }: { message: string }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(!!message);

  useEffect(() => {
    if (message) {
      setShown(true);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    } else if (shown) {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setShown(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        elevation.lg,
        {
          top: insets.top + space.sm,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
        },
      ]}
    >
      <Feather name="check-circle" size={16} color={palette.liveTeal} />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    left: space.xl,
    right: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    gap: space.sm,
    zIndex: 50,
  },
  text: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    fontWeight: '600',
  },
});
