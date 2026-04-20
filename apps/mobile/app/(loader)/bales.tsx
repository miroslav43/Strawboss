import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { mobileApiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

interface BaleLoadRecord {
  id: string;
  baleCount: number;
  parcelId: string | null;
  loadedAt: string;
  notes: string | null;
}

export default function LoaderBalesScreen() {
  const userId = useAuthStore((s) => s.userId);

  const { data: loads, isLoading } = useQuery({
    queryKey: ['bale-loads', 'my', userId],
    queryFn: () => mobileApiClient.get<BaleLoadRecord[]>(`/api/v1/bale-loads?operatorId=${userId}`),
    enabled: !!userId,
  });

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          <Text style={styles.title}>Încărcări de azi</Text>
        </View>
      </SafeAreaView>

      {isLoading ? (
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      ) : !loads || loads.length === 0 ? (
        <View style={[styles.body, styles.centered]}>
          <Text style={styles.emptyText}>Nicio încărcare înregistrată azi.</Text>
          <Text style={styles.emptySubtext}>Scanați un camion pentru a începe.</Text>
        </View>
      ) : (
        <FlatList
          style={styles.body}
          data={loads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Baloți</Text>
                <Text style={styles.cardValue}>{item.baleCount}</Text>
              </View>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Ora</Text>
                <Text style={styles.cardSubtext}>
                  {new Date(item.loadedAt).toLocaleTimeString('ro-RO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              {item.notes ? (
                <Text style={styles.notes}>{item.notes}</Text>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: '#0A5C36' },
  safeArea: { backgroundColor: '#0A5C36' },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: { justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: '#8D6E63' },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 13, color: '#5D4037' },
  cardValue: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  cardSubtext: { fontSize: 14, color: '#374151' },
  notes: { fontSize: 12, color: '#8D6E63', fontStyle: 'italic', marginTop: 4 },
});
