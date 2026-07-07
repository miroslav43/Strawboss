import { Pressable, View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

export type PendingTransitionStatus = 'pending' | 'in_flight' | 'failed';

interface PendingTransitionBadgeProps {
  /**
   * M11 — the actual sync_queue status for this trip's transition, not just
   * "has one" — `pending`/`in_flight` render the original amber "will send on
   * reconnect" badge; `failed` renders a distinct red, actionable variant.
   * Defaults to `pending` so existing callers that haven't been updated to
   * pass a real status keep the original look.
   */
  status?: PendingTransitionStatus;
  /** Tap-to-retry — only meaningful (and only rendered as tappable) when `status === 'failed'`. */
  onRetry?: () => void;
}

/**
 * FM-1 / M11: Discrete badge shown when a trip transition has been applied
 * optimistically but not yet confirmed by the server — amber while still in
 * flight, red and tappable once the server has rejected it enough times to be
 * marked `failed` (a driver needs to know this won't just resolve itself).
 */
export function PendingTransitionBadge({
  status = 'pending',
  onRetry,
}: PendingTransitionBadgeProps) {
  const { t } = useI18n();
  const isFailed = status === 'failed';

  const content = (
    <View
      style={[styles.container, isFailed && styles.containerFailed]}
      accessibilityLabel={t(
        isFailed
          ? 'shared.pendingTransitionBadge.failedA11y'
          : 'shared.pendingTransitionBadge.a11y',
      )}
    >
      <MaterialCommunityIcons
        name={isFailed ? 'alert-circle-outline' : 'cloud-upload-outline'}
        size={14}
        color={isFailed ? colors.danger : colors.warning}
      />
      <Text style={[styles.text, isFailed && styles.textFailed]}>
        {t(
          isFailed
            ? 'shared.pendingTransitionBadge.failedLabel'
            : 'shared.pendingTransitionBadge.label',
        )}
      </Text>
    </View>
  );

  if (isFailed && onRetry) {
    return (
      <Pressable onPress={onRetry} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFF8E1',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.warning,
    alignSelf: 'flex-start',
  },
  containerFailed: {
    backgroundColor: '#FDECEA',
    borderColor: colors.danger,
  },
  text: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
  textFailed: {
    color: colors.danger,
  },
});
