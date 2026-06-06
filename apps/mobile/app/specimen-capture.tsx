import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { SignatureCapture } from '@/components/shared/SignatureCapture';
import { BigButton } from '@/components/ui/BigButton';
import { uploadSpecimen } from '@/lib/signatureUpload';
import { useAuthStore } from '@/stores/auth-store';
import { mobileLogger } from '@/lib/logger';
import { fontScale } from '@/utils/responsive';
import { colors } from '@strawboss/ui-tokens';

/**
 * Signature specimen capture screen.
 *
 * Two modes:
 *  - First-time (default): triggered by AuthGate when `driver` or
 *    `loader_operator` logs in without a specimen. Hardware back is
 *    disabled — the user must complete capture to reach the app.
 *  - Redo (`?mode=redo`): launched from the profile screen so a user can
 *    update their existing specimen. Back navigation is enabled.
 */
export default function SpecimenCaptureScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isRedo = mode === 'redo';
  const queryClient = useQueryClient();
  const setSignatureSpecimenUrl = useAuthStore((s) => s.setSignatureSpecimenUrl);

  const [submitting, setSubmitting] = useState(false);

  // Block hardware back during first-time capture so a driver/loader cannot
  // dismiss the gate without setting a specimen.
  useEffect(() => {
    if (isRedo) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [isRedo]);

  const handleConfirm = useCallback(
    async (signatureBase64: string) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        const url = await uploadSpecimen(signatureBase64);
        setSignatureSpecimenUrl(url);
        await queryClient.invalidateQueries({ queryKey: ['profile'] });
        mobileLogger.flow('Specimen capture: saved', { url });
        if (isRedo) {
          router.back();
        } else {
          // AuthGate will pick up the new specimen URL and route to role home.
          router.replace('/');
        }
      } catch (err) {
        mobileLogger.error('Specimen capture: upload failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        Alert.alert(
          'Eroare',
          err instanceof Error
            ? err.message
            : 'Specimenul nu a putut fi salvat. Verifică conexiunea și încearcă din nou.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [isRedo, queryClient, setSignatureSpecimenUrl, submitting],
  );

  return (
    <View style={styles.outer}>
      <ScreenHeader title={isRedo ? 'Schimbă specimenul' : 'Specimen de semnătură'} />
      <View style={styles.body}>
        <View style={styles.intro}>
          <MaterialCommunityIcons name="signature-freehand" size={28} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {isRedo ? 'Redesenează semnătura ta' : 'Creează semnătura ta'}
            </Text>
            <Text style={styles.hint}>
              Specimenul se va folosi pe toate cursele (plecare șofer, încărcare operator).
              Asigură-te că este lizibil.
            </Text>
          </View>
        </View>

        <SignatureCapture label="Semnătura ta" onSave={(sig) => void handleConfirm(sig)} />

        {isRedo && !submitting ? (
          <BigButton title="Anulează" onPress={() => router.back()} variant="outline" />
        ) : null}
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
    gap: 16,
  },
  intro: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  title: { fontSize: fontScale(17), fontWeight: '700', color: '#0A5C36', marginBottom: 4 },
  hint: { fontSize: fontScale(13), color: '#5D4037', lineHeight: fontScale(18) },
});
