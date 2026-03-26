import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { LoadingFlow } from '@/components/features/loading/LoadingFlow';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { colors } from '@strawboss/ui-tokens';

export default function LoadScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();

  if (!tripId) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: true, title: 'Loading' }} />
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>No trip selected</Text>
          <Text style={styles.errorSubtext}>
            Navigate from a trip to start loading.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Loading' }} />
      <OfflineBanner />
      <LoadingFlow
        tripId={tripId}
        onComplete={() => {
          router.back();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.danger,
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.neutral,
    textAlign: 'center',
  },
});
