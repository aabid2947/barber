import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { hit, palette, radius, space } from '../../theme/tokens';
import { PressableScale } from './PressableScale';

export interface SegOption {
  key: string;
  label: string;
}

interface SegmentedProps {
  options: SegOption[];
  value: string;
  onChange: (key: string) => void;
  /** Scroll horizontally when options overflow (default true). */
  scroll?: boolean;
}

/** Horizontal pill selector — calm accent-tinted active state, large hit areas. */
export function Segmented({ options, value, onChange, scroll = true }: SegmentedProps) {
  const content = options.map((opt) => {
    const active = opt.key === value;
    return (
      <PressableScale
        key={opt.key}
        onPress={() => onChange(opt.key)}
        style={[styles.seg, active ? styles.segActive : styles.segIdle]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>{opt.label}</Text>
      </PressableScale>
    );
  });

  if (!scroll) return <View style={styles.row}>{content}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
    paddingRight: space.xl,
  },
  seg: {
    height: hit.chip,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  segActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accentSoftLine,
  },
  segIdle: {
    backgroundColor: palette.surface,
    borderColor: palette.line,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
  labelActive: { color: palette.accentInk },
  labelIdle: { color: palette.inkMuted },
});
