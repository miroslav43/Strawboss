import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { fontScale } from '@/utils/responsive';
import { getSupabaseClient } from '@/lib/auth';
import { clearLocalData } from '@/lib/storage';
import { mobileApiClient } from '@/lib/api-client';
import { registerForPushNotifications } from '@/lib/notifications';
import { useAuthStore } from '@/stores/auth-store';
import { useDevModeStore } from '@/stores/dev-mode-store';
import { useI18n } from '@/lib/i18n';

/**
 * M10 — landing screen for non-field roles (dispatcher/admin/super_admin).
 *
 * These roles have no mobile workflow (no assigned machine, no trip-signing
 * flow) — before this screen they were routed to `/(tabs)` and landed on the
 * home screen's "no machine assigned" card forever, which reads as a bug
 * rather than "this app isn't for you." `_layout.tsx`'s AuthGate routes these
 * roles here instead of the operator fallback and keeps redirecting them back
 * whenever they land elsewhere, so the only way out is logging out.
 */
export default function WebOnlyScreen() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { clear } = useAuthStore();
  const { hideSync } = useDevModeStore();

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    // Deactivate this device's push token before signing out (while the JWT
    // is still valid) — mirrors ProfileScreen.handleLogout.
    try {
      const token = await registerForPushNotifications();
      if (token) {
        await mobileApiClient.post('/api/v1/notifications/unregister-token', { token });
      }
    } catch {
      // Non-critical — covered by server-side cross-user cleanup on next login.
    }
    await supabase.auth.signOut();
    await clearLocalData();
    queryClient.clear();
    clear();
    hideSync();
  };

  return (
    <View style={styles.outer}>
      <ScreenHeader title={t('webOnly.title')} right={null} />
      <View style={styles.body}>
        <View style={styles.card}>
          <MaterialCommunityIcons name="monitor-dashboard" size={40} color={colors.primary} />
          <Text style={styles.bodyText}>{t('webOnly.body')}</Text>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={() => void handleLogout()}>
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.primary },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    gap: 20,
  },
  card: {
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 24,
    marginTop: 16,
  },
  bodyText: {
    fontSize: fontScale(14),
    color: '#5D4037',
    textAlign: 'center',
    lineHeight: fontScale(20),
  },
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
    marginBottom: 16,
  },
  logoutText: { color: colors.white, fontSize: fontScale(17), fontWeight: '700' },
});
