import React from 'react';
import { ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radius, space, type } from '../../theme/tokens';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Extra bottom space so content clears the floating tab bar. */
  clearsTabBar?: boolean;
  contentStyle?: ViewStyle;
}

export function Screen({ children, scroll = true, clearsTabBar = true, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padTop = insets.top + space.lg;
  const padBottom = (clearsTabBar ? 124 : space['3xl']) + insets.bottom;

  if (!scroll) {
    return (
      <View style={[styles.canvas, { paddingTop: padTop, paddingHorizontal: space.xl, paddingBottom: padBottom }, contentStyle]}>
        {children}
      </View>
    );
  }
  return (
    <View style={styles.canvas}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[{ paddingTop: padTop, paddingHorizontal: space.xl, paddingBottom: padBottom }, contentStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}

interface HeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function ScreenHeader({ eyebrow, title, subtitle, right }: HeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          {eyebrow ? (
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowTick} />
              <Text style={[type.label, styles.eyebrow]}>{eyebrow}</Text>
            </View>
          ) : null}
          <Text style={type.titleXl}>{title}</Text>
          {subtitle ? <Text style={[type.bodyMuted, styles.subtitle]}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={styles.headerRight}>{right}</View> : null}
      </View>
      {/* line-art structural rule beneath every screen header */}
      <View style={styles.headerRule} />
    </View>
  );
}

interface SectionProps {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Section({ title, action, children, style }: SectionProps) {
  return (
    <View style={[styles.section, style]}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          {title ? (
            <View style={styles.sectionTitleRow}>
              <View style={styles.sectionMarker} />
              <Text style={type.heading}>{title}</Text>
            </View>
          ) : (
            <View />
          )}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: palette.canvas,
  },
  header: {
    marginBottom: space['2xl'],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerText: { flex: 1 },
  headerRight: { marginLeft: space.lg },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  eyebrowTick: { width: 18, height: 2.5, borderRadius: 2, backgroundColor: palette.accent },
  eyebrow: { color: palette.accentInk },
  subtitle: { marginTop: 8 },
  headerRule: {
    height: 1,
    backgroundColor: palette.line,
    marginTop: space.xl,
  },
  section: { marginTop: space['3xl'] },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionMarker: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: palette.accent,
  },
});
