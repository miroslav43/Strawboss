import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type AlertSeverity = 'warning' | 'error';

interface AlertBannerProps {
  message: string;
  severity: AlertSeverity;
  onDismiss?: () => void;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { background: string; text: string; iconName: 'alert' | 'close-circle' }
> = {
  warning: {
    background: '#FEF3C7',
    text: '#92400E',
    iconName: 'alert',
  },
  error: {
    background: '#FEE2E2',
    text: '#991B1B',
    iconName: 'close-circle',
  },
} as const;

export function AlertBanner({ message, severity, onDismiss }: AlertBannerProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: config.background,
          borderLeftColor: config.text,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={config.iconName}
        size={18}
        color={config.text}
        accessibilityLabel={severity === 'warning' ? 'Avertisment' : 'Eroare'}
      />
      <Text style={[styles.message, { color: config.text }]}>{message}</Text>
      {onDismiss !== undefined && (
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Închide alerta"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={20} color={config.text} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
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
    width: 28,
    height: 28,
  },
});
