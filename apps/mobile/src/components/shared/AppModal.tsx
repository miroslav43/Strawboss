import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Animated, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { scale, fontScale } from '@/utils/responsive';
import { radii } from '@strawboss/ui-tokens';
import { useI18n } from '@/lib/i18n';

export type AppModalType = 'error' | 'warning' | 'success' | 'confirm';

export interface AppModalProps {
  visible: boolean;
  type: AppModalType;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  autoDismiss?: boolean;
}

type MCIcon = 'alert-circle' | 'alert' | 'check-circle' | 'help-circle';

const SEVERITY_CONFIG: Record<
  AppModalType,
  { accent: string; iconBg: string; iconColor: string; icon: MCIcon; btnColor: string }
> = {
  error: {
    accent: '#C62828',
    iconBg: '#FFEBEE',
    iconColor: '#C62828',
    icon: 'alert-circle',
    btnColor: '#C62828',
  },
  warning: {
    accent: '#B7791F',
    iconBg: '#FFF8E1',
    iconColor: '#B7791F',
    icon: 'alert',
    btnColor: '#B7791F',
  },
  success: {
    accent: '#2E7D32',
    iconBg: '#E8F5E9',
    iconColor: '#2E7D32',
    icon: 'check-circle',
    btnColor: '#0A5C36',
  },
  confirm: {
    accent: '#1565C0',
    iconBg: '#E3F2FD',
    iconColor: '#1565C0',
    icon: 'help-circle',
    btnColor: '#1565C0',
  },
} as const;

export function AppModal({
  visible,
  type,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  autoDismiss = false,
}: AppModalProps) {
  const { t } = useI18n();
  const config = SEVERITY_CONFIG[type];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const showCancel = onCancel !== undefined;
  const resolvedCancelText = cancelText ?? t('common.cancel');
  const resolvedConfirmText =
    confirmText ?? (type === 'confirm' ? t('common.yes') : t('common.ok'));

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [visible, fadeAnim]);

  useEffect(() => {
    if (visible && autoDismiss) {
      const t = setTimeout(onConfirm, 2000);
      return () => clearTimeout(t);
    }
  }, [visible, autoDismiss, onConfirm]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onCancel ?? onConfirm}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <View style={styles.card}>
          <View style={[styles.accent, { backgroundColor: config.accent }]} />
          <View style={styles.body}>
            <View style={[styles.iconWrap, { backgroundColor: config.iconBg }]}>
              <MaterialCommunityIcons
                name={config.icon}
                size={scale(26)}
                color={config.iconColor}
                accessibilityLabel={title}
              />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <ScrollView
              style={styles.messageScroll}
              contentContainerStyle={styles.messageScrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Text style={styles.message}>{message}</Text>
            </ScrollView>
            <View style={styles.buttons}>
              {showCancel && (
                <Pressable
                  style={[styles.btn, styles.btnCancel]}
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel={resolvedCancelText}
                  android_ripple={{ color: '#ddd' }}
                >
                  <Text style={styles.btnCancelText}>{resolvedCancelText}</Text>
                </Pressable>
              )}
              <Pressable
                style={[
                  styles.btn,
                  styles.btnConfirm,
                  { backgroundColor: config.btnColor },
                  showCancel && styles.btnFlex,
                ]}
                onPress={onConfirm}
                accessibilityRole="button"
                accessibilityLabel={resolvedConfirmText}
                android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
              >
                <Text style={styles.btnConfirmText}>{resolvedConfirmText}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(32),
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#fff',
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  accent: {
    height: 4,
  },
  body: {
    padding: scale(20),
    alignItems: 'center',
  },
  iconWrap: {
    width: scale(52),
    height: scale(52),
    borderRadius: scale(26),
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: scale(12),
  },
  title: {
    fontSize: fontScale(17),
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: scale(6),
  },
  messageScroll: {
    alignSelf: 'stretch',
    maxHeight: scale(220),
    marginBottom: scale(20),
  },
  messageScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  message: {
    fontSize: fontScale(14),
    color: '#555',
    textAlign: 'center',
    lineHeight: fontScale(20),
  },
  buttons: {
    flexDirection: 'row',
    gap: scale(8),
    width: '100%',
  },
  btn: {
    borderRadius: radii.md,
    paddingVertical: scale(12),
    paddingHorizontal: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFlex: {
    flex: 1,
  },
  btnCancel: {
    flex: 1,
    backgroundColor: '#F3DED8',
  },
  btnCancelText: {
    fontSize: fontScale(14),
    fontWeight: '600',
    color: '#5D4037',
  },
  btnConfirm: {
    flex: 2,
  },
  btnConfirmText: {
    fontSize: fontScale(14),
    fontWeight: '700',
    color: '#fff',
  },
});
