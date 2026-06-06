import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { ProductionNumpad } from '@/components/features/production/ProductionNumpad';
import { FieldActiveNumpad } from '@/components/features/production/FieldActiveNumpad';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { useAuthStore } from '@/stores/auth-store';
import { useFieldActiveStore } from '@/stores/field-active-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';

export default function BalerProductionScreen() {
  const userId = useAuthStore((s) => s.userId);
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const { fieldActive, enableFieldActive, disableFieldActive } = useFieldActiveStore();
  const insets = useSafeAreaInsets();

  // Keep screen awake while fieldActive is true.
  useEffect(() => {
    if (fieldActive) {
      void activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
    return () => {
      // Always deactivate on unmount.
      deactivateKeepAwake();
    };
  }, [fieldActive]);

  // Minimal "Câmp activ" layout — just numpad + save + counter.
  if (fieldActive) {
    return (
      <View style={styles.fieldActiveContainer}>
        <View style={[styles.fieldActiveHeader, { paddingTop: insets.top + 12 }]}>
          <View style={styles.fieldActiveBadge}>
            <MaterialCommunityIcons name="weather-sunny" size={16} color={colors.warning} />
            <Text style={styles.fieldActiveBadgeText}>Câmp activ</Text>
          </View>
          <TouchableOpacity
            style={styles.exitButton}
            onPress={disableFieldActive}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Ieși din modul Câmp activ"
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.white} />
            <Text style={styles.exitButtonText}>Ieși</Text>
          </TouchableOpacity>
        </View>
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : (
          <View style={styles.fieldActiveBody}>
            <FieldActiveNumpad operatorId={userId} balerId={assignedMachineId} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <ScreenHeader title="Producție">
        <View style={styles.headerRow}>
          <Text style={styles.subtitle}>Introdu numărul de baloți</Text>
          <TouchableOpacity
            style={styles.fieldActiveToggle}
            onPress={enableFieldActive}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Activează modul Câmp activ"
          >
            <MaterialCommunityIcons name="weather-sunny" size={14} color={colors.warning} />
            <Text style={styles.fieldActiveToggleText}>Câmp activ</Text>
          </TouchableOpacity>
        </View>
      </ScreenHeader>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!userId ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#0A5C36" />
          </View>
        ) : (
          <ProductionNumpad operatorId={userId} balerId={assignedMachineId} />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Normal mode
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtitle: { fontSize: 13, color: 'rgba(255, 255, 255, 0.8)' },
  fieldActiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  fieldActiveToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.white,
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Field-active mode
  fieldActiveContainer: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  fieldActiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  fieldActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldActiveBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  exitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  exitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  fieldActiveBody: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
