import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radius, space, type } from '../../theme/tokens';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface EmptyStateProps {
  icon: FeatherName;
  title: string;
  hint?: string;
}

/** Calm placeholder for empty lists — keeps the airy feel instead of a bare line of text. */
export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Feather name={icon} size={22} color={palette.inkFaint} />
      </View>
      <Text style={[type.body, styles.title]}>{title}</Text>
      {hint ? <Text style={[type.small, styles.hint]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: space['3xl'],
    paddingHorizontal: space.xl,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: { fontWeight: '600' },
  hint: { marginTop: 4, textAlign: 'center' },
});
