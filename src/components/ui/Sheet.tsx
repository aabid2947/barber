import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, palette, radius, space, type } from '../../theme/tokens';
import { Button } from './Button';

const SCREEN_H = Dimensions.get('window').height;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  scroll?: boolean;
}

export function BottomSheet({ visible, onClose, title, subtitle, children, scroll = false }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const overlay = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 4 }),
          Animated.timing(overlay, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      });
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }),
        Animated.timing(overlay, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  const Inner = (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.grabber} />
      {title ? (
        <View style={styles.head}>
          <Text style={type.title}>{title}</Text>
          {subtitle ? <Text style={[type.bodyMuted, { marginTop: 4 }]}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {scroll ? <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.scroll}>{children}</ScrollView> : children}
    </View>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <Animated.View style={[elevation.xl, { transform: [{ translateY }] }]}>{Inner}</Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmSheet({ visible, onClose, title, message, confirmLabel, destructive, loading, onConfirm }: ConfirmSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <Text style={[type.body, styles.confirmMsg]}>{message}</Text>
      <View style={styles.confirmBtns}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={confirmLabel}
            variant={destructive ? 'danger' : 'primary'}
            onPress={onConfirm}
            loading={loading}
            fullWidth
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(51, 38, 14, 0.42)' },
  kav: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: palette.lineStrong,
    marginBottom: space.lg,
  },
  head: { marginBottom: space.xl },
  scroll: { maxHeight: SCREEN_H * 0.6 },
  confirmMsg: { color: palette.inkMuted, marginBottom: space['2xl'] },
  confirmBtns: { flexDirection: 'row', gap: space.md },
});
