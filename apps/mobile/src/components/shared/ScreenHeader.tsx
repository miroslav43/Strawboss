import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationBell } from './NotificationBell';

interface ScreenHeaderProps {
  /** Big white title displayed on the green surface. */
  title: string;
  /** Optional subtitle/meta rendered below the title (e.g. truck + GPS). */
  children?: ReactNode;
  /**
   * Custom right-side slot. Defaults to the notification bell so that every
   * screen keeps the bell visible after removing the native Tabs header.
   * Pass `null` to hide it entirely.
   */
  right?: ReactNode | null;
  /** Optional override for the outer container style. */
  style?: ViewStyle;
}

/**
 * Unified green in-screen header used across every tab screen.
 *
 * Replaces the native Tabs header (which was duplicating the title with the
 * in-screen title). Keeps the notification bell accessible on the right.
 */
export function ScreenHeader({ title, children, right, style }: ScreenHeaderProps) {
  const rightNode = right === undefined ? <NotificationBell /> : right;

  return (
    <SafeAreaView style={[styles.safeArea, style]} edges={['top']}>
      <View style={styles.row}>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {children ? <View style={styles.meta}>{children}</View> : null}
        </View>
        {rightNode ? <View style={styles.rightSlot}>{rightNode}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#0A5C36' },
  row: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleColumn: { flex: 1, gap: 4 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  meta: { gap: 4 },
  rightSlot: { marginLeft: 12, marginTop: -4 },
});
