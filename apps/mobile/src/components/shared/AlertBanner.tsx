import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

type AlertSeverity = 'warning' | 'error';

interface AlertBannerProps {
  message: string;
  severity: AlertSeverity;
  onDismiss?: () => void;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { background: string; text: string; icon: string }
> = {
  warning: {
    background: '#FEF3C7',
    text: '#92400E',
    icon: '\u26A0\uFE0F',
  },
  error: {
    background: '#FEE2E2',
    text: '#991B1B',
    icon: '\u274C',
  },
} as const;

export function AlertBanner({ message, severity, onDismiss }: AlertBannerProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <View style={[styles.container, { backgroundColor: config.background }]}>
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={[styles.message, { color: config.text }]}>{message}</Text>
      {onDismiss !== undefined && (
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.dismissIcon, { color: config.text }]}>{'×'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  icon: {
    fontSize: 18,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  dismissButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 24,
    height: 24,
  },
  dismissIcon: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
});
