import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OperatorStats } from '@/components/features/stats/OperatorStats';
import { useAuthStore } from '@/stores/auth-store';

export default function BalerStatsScreen() {
  const userId = useAuthStore((s) => s.userId);

  if (!userId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Starea Mea</Text>
        <Text style={styles.subtitle}>Consumuri și producție</Text>
      </View>
      <OperatorStats operatorId={userId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0A5C36' },
  subtitle: { fontSize: 13, color: '#5D4037', marginTop: 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
