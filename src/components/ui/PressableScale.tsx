import React, { useRef } from 'react';
import { Animated, GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

interface Props extends PressableProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale applied while pressed (default 0.97). */
  activeScale?: number;
  disabled?: boolean;
}

/**
 * A Pressable with a soft spring scale on touch — the quiet micro-interaction that
 * makes the large, rounded hit areas feel responsive without adding visual noise.
 */
export function PressableScale({ children, style, activeScale = 0.97, disabled, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  return (
    <Pressable
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        if (!disabled) animateTo(activeScale);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        animateTo(1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
