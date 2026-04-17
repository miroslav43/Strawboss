import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { User, Machine } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';

const ROLE_LABEL: Record<string, string> = {
  driver: 'Șofer',
  loader_operator: 'Operator Încărcător',
  baler_operator: 'Operator Balotieră',
  admin: 'Administrator',
};

type MachineIconName = 'wrench' | 'grain' | 'truck' | 'map-marker';
const MACHINE_MDI: Record<string, MachineIconName> = {
  loader: 'wrench',
  baler: 'grain',
  truck: 'truck',
};

export function ProfileScreen() {
  const { clear } = useAuthStore();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  const assignedMachineId = profile?.assignedMachineId ?? null;
  const { data: machine, isLoading: machineLoading } = useQuery({
    queryKey: ['machine', assignedMachineId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${assignedMachineId}`),
    enabled: !!assignedMachineId,
  });

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    clear();
  };

  const isLoading = profileLoading || (!!assignedMachineId && machineLoading);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Contul meu</Text>

        {isLoading ? (
          <ActivityIndicator size="large" color="#0A5C36" style={{ marginTop: 40 }} />
        ) : profile ? (
          <>
            {/* User info card */}
            <View style={styles.card}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {profile.fullName?.charAt(0)?.toUpperCase() ?? '?'}
                </Text>
              </View>
              <Text style={styles.fullName}>{profile.fullName}</Text>
              <Text style={styles.email}>{profile.email}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>
                  {ROLE_LABEL[profile.role] ?? profile.role}
                </Text>
              </View>
            </View>

            {/* Assigned machine card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mașina asignată</Text>
              {!assignedMachineId ? (
                <Text style={styles.noMachine}>Nicio mașină asignată</Text>
              ) : machine ? (
                <View style={styles.machineRow}>
                  <MaterialCommunityIcons
                    name={MACHINE_MDI[machine.machineType] ?? 'map-marker'}
                    size={28}
                    color="#0A5C36"
                  />
                  <View>
                    <Text style={styles.machineCode}>{machine.internalCode}</Text>
                    <Text style={styles.machineDetail}>
                      {machine.make} {machine.model}
                    </Text>
                    {machine.registrationPlate ? (
                      <Text style={styles.machinePlate}>{machine.registrationPlate}</Text>
                    ) : null}
                  </View>
                </View>
              ) : (
                <Text style={styles.noMachine}>Nu s-a putut încărca mașina</Text>
              )}
            </View>
          </>
        ) : (
          <Text style={styles.noMachine}>Nu s-au putut încărca datele profilului</Text>
        )}

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Deconectare</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3DED8' },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0A5C36', marginBottom: 8 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037', alignSelf: 'flex-start' },

  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0A5C36',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  fullName: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  email: { fontSize: 14, color: '#5D4037' },

  roleBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 4,
  },
  roleText: { fontSize: 13, fontWeight: '600', color: '#0A5C36' },

  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'flex-start' },
  machineCode: { fontSize: 16, fontWeight: '700', color: '#0A5C36' },
  machineDetail: { fontSize: 13, color: '#5D4037' },
  machinePlate: { fontSize: 12, color: '#9ca3af' },
  noMachine: { fontSize: 14, color: '#8D6E63', fontStyle: 'italic' },

  logoutButton: {
    backgroundColor: '#C62828',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
