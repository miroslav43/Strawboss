import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Farm } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n';

interface Props {
  visible: boolean;
  parcelId: string | null;
  onClose: () => void;
}

export function AssignFarmModal({ visible, parcelId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const { modalProps, showModal, hideModal } = useModal();
  const { t } = useI18n();

  const { data: farms = [], isLoading } = useQuery({
    queryKey: ['farms'],
    queryFn: () => mobileApiClient.get<Farm[]>('/api/v1/farms'),
    staleTime: 5 * 60_000,
    enabled: visible,
  });

  async function assign(farmId: string) {
    if (!parcelId) return;
    setSavingId(farmId);
    try {
      await mobileApiClient.patch(`/api/v1/parcels/${parcelId}`, { farmId });
      await queryClient.invalidateQueries({ queryKey: ['geofence-editor-parcels'] });
      await queryClient.invalidateQueries({ queryKey: ['farms'] });
      onClose();
    } catch {
      showModal({
        type: 'error',
        title: t('geofenceMaker.assignFarm.error.title'),
        message: t('geofenceMaker.assignFarm.error.message'),
        onConfirm: hideModal,
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8 },
        ]}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('geofenceMaker.assignFarm.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} disabled={savingId !== null}>
            <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#0A5C36" />
            <Text style={styles.loadingText}>{t('geofenceMaker.assignFarm.loading')}</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {farms.length === 0 ? (
              <Text style={styles.emptyText}>{t('geofenceMaker.assignFarm.empty')}</Text>
            ) : (
              farms.map((farm) => {
                const isSavingThis = savingId === farm.id;
                return (
                  <TouchableOpacity
                    key={farm.id}
                    style={styles.farmItem}
                    onPress={() => assign(farm.id)}
                    activeOpacity={0.7}
                    disabled={savingId !== null}
                  >
                    <View style={styles.farmIconWrap}>
                      <MaterialCommunityIcons name="home-group" size={22} color="#0A5C36" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.farmName}>{farm.name}</Text>
                      {farm.phone ? <Text style={styles.farmSub}>📞 {farm.phone}</Text> : null}
                      {farm.address ? <Text style={styles.farmSub}>{farm.address}</Text> : null}
                    </View>
                    {isSavingThis ? (
                      <ActivityIndicator color="#0A5C36" />
                    ) : (
                      <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}
        <AppModal {...modalProps} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
    justifyContent: 'center',
  },
  loadingText: { fontSize: 14, color: '#5D4037' },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    paddingVertical: 32,
    paddingHorizontal: 12,
  },
  farmItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  farmIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  farmName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  farmSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
});
