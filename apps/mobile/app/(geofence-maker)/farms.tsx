import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useModal } from '@/hooks/useModal';
import { AppModal } from '@/components/shared/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { Farm, Parcel } from '@strawboss/types';
import { FarmEntityType } from '@strawboss/types';

const ENTITY_LABELS: Record<FarmEntityType, string> = {
  [FarmEntityType.persoana_juridica]: 'Persoană juridică',
  [FarmEntityType.persoana_fizica]: 'Persoană fizică',
};
import { mobileApiClient } from '@/lib/api-client';
import { ScreenHeader } from '@/components/shared/ScreenHeader';
import { AssignFarmModal } from '@/components/geofence-maker/AssignFarmModal';
import { colors } from '@strawboss/ui-tokens';

const HARVEST_LABELS: Record<string, string> = {
  planned: 'Planificat',
  to_harvest: 'De recoltat',
  harvesting: 'În recoltare',
  harvested: 'Recoltat',
};

const HARVEST_COLORS: Record<string, string> = {
  planned: '#6B7280',
  to_harvest: '#D97706',
  harvesting: '#2563EB',
  harvested: '#16A34A',
};

export default function FarmsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [farmName, setFarmName] = useState('');
  const [farmPhone, setFarmPhone] = useState('');
  const [farmEntityType, setFarmEntityType] = useState<FarmEntityType | ''>('');
  const [farmCui, setFarmCui] = useState('');
  const [farmApia, setFarmApia] = useState('');
  const [farmAddress, setFarmAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [assignParcelId, setAssignParcelId] = useState<string | null>(null);
  const { modalProps, showModal, hideModal } = useModal();

  const goToMap = useCallback(
    (parcelId: string) => {
      router.push({ pathname: '/(geofence-maker)/map', params: { focusParcelId: parcelId } });
    },
    [router],
  );

  const {
    data: farms = [],
    isLoading: farmsLoading,
    refetch: refetchFarms,
  } = useQuery({
    queryKey: ['farms'],
    queryFn: () => mobileApiClient.get<Farm[]>('/api/v1/farms'),
    staleTime: 2 * 60_000,
  });

  const {
    data: parcels = [],
    isLoading: parcelsLoading,
    refetch: refetchParcels,
  } = useQuery({
    queryKey: ['geofence-editor-parcels'],
    queryFn: () => mobileApiClient.get<Parcel[]>('/api/v1/parcels'),
    staleTime: 2 * 60_000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchFarms(), refetchParcels()]);
    setRefreshing(false);
  }, [refetchFarms, refetchParcels]);

  const parcelsByFarm = useCallback(
    (farmId: string) => parcels.filter((p) => p.farmId === farmId),
    [parcels],
  );

  const unassignedParcels = parcels.filter((p) => !p.farmId);

  function toggleExpand(farmId: string) {
    setExpandedId((prev) => (prev === farmId ? null : farmId));
  }

  function openCreate() {
    setFarmName('');
    setFarmAddress('');
    setCreateVisible(true);
  }

  async function handleCreate() {
    if (!farmName.trim()) {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: 'Numele fermei este obligatoriu.',
        onConfirm: hideModal,
      });
      return;
    }
    if (!farmPhone.trim()) {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: 'Numărul de telefon este obligatoriu.',
        onConfirm: hideModal,
      });
      return;
    }
    setIsSaving(true);
    try {
      await mobileApiClient.post('/api/v1/farms', {
        name: farmName.trim(),
        phone: farmPhone.trim(),
        entityType: farmEntityType || undefined,
        cui: farmCui.trim() || undefined,
        apiaCode: farmApia.trim() || undefined,
        address: farmAddress.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['farms'] });
      setFarmName('');
      setFarmPhone('');
      setFarmEntityType('');
      setFarmCui('');
      setFarmApia('');
      setFarmAddress('');
      setCreateVisible(false);
    } catch {
      showModal({
        type: 'error',
        title: 'Eroare',
        message: 'Nu s-a putut crea ferma. Încearcă din nou.',
        onConfirm: hideModal,
      });
    } finally {
      setIsSaving(false);
    }
  }

  const isLoading = farmsLoading || parcelsLoading;

  return (
    <View style={[styles.outer, { backgroundColor: colors.primary }]}>
      <ScreenHeader
        title="Ferme"
        right={
          <TouchableOpacity
            style={styles.addBtn}
            onPress={openCreate}
            accessibilityRole="button"
            accessibilityLabel="Fermă nouă"
          >
            <MaterialCommunityIcons name="plus" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Fermă nouă</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Se încarcă fermele...</Text>
          </View>
        ) : farms.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="home-group" size={32} color={colors.tertiary} />
            <Text style={styles.emptyTitle}>Nicio fermă înregistrată</Text>
            <Text style={styles.emptySub}>Apasă „Fermă nouă" pentru a adăuga prima fermă.</Text>
          </View>
        ) : (
          farms.map((farm) => {
            const farmParcels = parcelsByFarm(farm.id);
            const isExpanded = expandedId === farm.id;
            return (
              <View key={farm.id} style={styles.farmCard}>
                <TouchableOpacity
                  style={styles.farmHeader}
                  onPress={() => toggleExpand(farm.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.farmIconWrap}>
                    <MaterialCommunityIcons name="home-group" size={22} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.farmName}>{farm.name}</Text>
                    {farm.entityType ? (
                      <View style={styles.entityChip}>
                        <Text style={styles.entityChipText}>{ENTITY_LABELS[farm.entityType]}</Text>
                      </View>
                    ) : null}
                    {farm.phone ? <Text style={styles.farmAddr}>📞 {farm.phone}</Text> : null}
                    {farm.address ? <Text style={styles.farmAddr}>{farm.address}</Text> : null}
                    {farm.cui ? <Text style={styles.farmAddr}>CUI: {farm.cui}</Text> : null}
                    {farm.apiaCode ? (
                      <Text style={styles.farmAddr}>APIA: {farm.apiaCode}</Text>
                    ) : null}
                    <Text style={styles.farmMeta}>{farmParcels.length} câmpuri</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={24}
                    color={colors.tertiary}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.parcelList}>
                    {farmParcels.length === 0 ? (
                      <Text style={styles.noParcelText}>Niciun câmp asignat acestei ferme.</Text>
                    ) : (
                      farmParcels.map((p) => (
                        <ParcelRow key={p.id} parcel={p} onViewOnMap={goToMap} />
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* Unassigned parcels */}
        {!isLoading && unassignedParcels.length > 0 && (
          <View style={styles.farmCard}>
            <TouchableOpacity
              style={styles.farmHeader}
              onPress={() => toggleExpand('__unassigned__')}
              activeOpacity={0.7}
            >
              <View style={[styles.farmIconWrap, { backgroundColor: '#FEF3C7' }]}>
                <MaterialCommunityIcons name="help-circle-outline" size={22} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.farmName, { color: '#D97706' }]}>Fără fermă</Text>
                <Text style={styles.farmMeta}>{unassignedParcels.length} câmpuri neasignate</Text>
              </View>
              <MaterialCommunityIcons
                name={expandedId === '__unassigned__' ? 'chevron-up' : 'chevron-down'}
                size={24}
                color={colors.tertiary}
              />
            </TouchableOpacity>
            {expandedId === '__unassigned__' && (
              <View style={styles.parcelList}>
                {unassignedParcels.map((p) => (
                  <ParcelRow
                    key={p.id}
                    parcel={p}
                    onViewOnMap={goToMap}
                    onAssign={setAssignParcelId}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Create farm modal */}
      <Modal
        visible={createVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            style={[
              styles.modalContainer,
              { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 8 },
            ]}
          >
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Fermă nouă</Text>
              <TouchableOpacity onPress={() => setCreateVisible(false)} hitSlop={12}>
                <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.inputLabel}>
                Nume fermă <Text style={{ color: '#DC2626' }}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={farmName}
                onChangeText={setFarmName}
                placeholder="ex. Ferma Dunărea"
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
                autoFocus
              />

              <Text style={styles.inputLabel}>
                Telefon <Text style={{ color: '#DC2626' }}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={farmPhone}
                onChangeText={setFarmPhone}
                placeholder="ex. 0722 123 456"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                returnKeyType="next"
              />

              <Text style={styles.inputLabel}>Tip entitate</Text>
              <View style={styles.entitySegmentRow}>
                <TouchableOpacity
                  style={[
                    styles.entitySegmentBtn,
                    farmEntityType === FarmEntityType.persoana_juridica &&
                      styles.entitySegmentBtnActive,
                  ]}
                  onPress={() =>
                    setFarmEntityType(
                      farmEntityType === FarmEntityType.persoana_juridica
                        ? ''
                        : FarmEntityType.persoana_juridica,
                    )
                  }
                >
                  <Text
                    style={[
                      styles.entitySegmentText,
                      farmEntityType === FarmEntityType.persoana_juridica &&
                        styles.entitySegmentTextActive,
                    ]}
                  >
                    Persoană juridică
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.entitySegmentBtn,
                    farmEntityType === FarmEntityType.persoana_fizica &&
                      styles.entitySegmentBtnActive,
                  ]}
                  onPress={() =>
                    setFarmEntityType(
                      farmEntityType === FarmEntityType.persoana_fizica
                        ? ''
                        : FarmEntityType.persoana_fizica,
                    )
                  }
                >
                  <Text
                    style={[
                      styles.entitySegmentText,
                      farmEntityType === FarmEntityType.persoana_fizica &&
                        styles.entitySegmentTextActive,
                    ]}
                  >
                    Persoană fizică
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>CUI</Text>
              <TextInput
                style={styles.input}
                value={farmCui}
                onChangeText={setFarmCui}
                placeholder="ex. RO12345678 (opțional)"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
                returnKeyType="next"
              />

              <Text style={styles.inputLabel}>Cod RO APIA</Text>
              <TextInput
                style={styles.input}
                value={farmApia}
                onChangeText={setFarmApia}
                placeholder="Cod APIA al fermei (opțional)"
                placeholderTextColor="#9CA3AF"
                returnKeyType="next"
              />

              <Text style={styles.inputLabel}>Adresă</Text>
              <TextInput
                style={styles.input}
                value={farmAddress}
                onChangeText={setFarmAddress}
                placeholder="Adresă (opțional)"
                placeholderTextColor="#9CA3AF"
                returnKeyType="done"
                onSubmitEditing={handleCreate}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setCreateVisible(false)}
                disabled={isSaving}
              >
                <Text style={styles.modalCancelText}>Anulează</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, isSaving && styles.modalSaveBtnDisabled]}
                onPress={handleCreate}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Creează ferma</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AssignFarmModal
        visible={!!assignParcelId}
        parcelId={assignParcelId}
        onClose={() => setAssignParcelId(null)}
      />
      <AppModal {...modalProps} />
    </View>
  );
}

function ParcelRow({
  parcel,
  onViewOnMap,
  onAssign,
}: {
  parcel: Parcel;
  onViewOnMap: (parcelId: string) => void;
  onAssign?: (parcelId: string) => void;
}) {
  const hasBoundary = !!parcel.boundary;
  const status = parcel.harvestStatus ?? 'planned';
  const statusColor = HARVEST_COLORS[status] ?? '#6B7280';
  const statusLabel = HARVEST_LABELS[status] ?? status;
  const area = typeof parcel.areaHectares === 'number' ? parcel.areaHectares.toFixed(2) : '–';
  const code = parcel.code ?? '';
  const name = parcel.name ?? '(fără nume)';

  return (
    <View style={styles.parcelRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.parcelNameRow}>
          <Text style={styles.parcelCode}>{code}</Text>
          <Text style={styles.parcelName} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View style={styles.parcelMeta}>
          <Text
            style={[styles.parcelStatusBadge, { color: statusColor, borderColor: statusColor }]}
          >
            {statusLabel}
          </Text>
          <Text style={styles.parcelArea}>{area} ha</Text>
          {!hasBoundary && (
            <MaterialCommunityIcons name="map-marker-off" size={14} color="#D1D5DB" />
          )}
        </View>
      </View>
      <View style={styles.parcelActions}>
        {hasBoundary && (
          <TouchableOpacity
            onPress={() => onViewOnMap(parcel.id)}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Vezi pe hartă"
          >
            <MaterialCommunityIcons name="map-search" size={20} color="#0A5C36" />
          </TouchableOpacity>
        )}
        {onAssign && (
          <TouchableOpacity
            onPress={() => onAssign(parcel.id)}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Asignează fermă"
          >
            <MaterialCommunityIcons name="home-plus-outline" size={20} color="#D97706" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  body: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { padding: 16, gap: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 24 },
  loadingText: { fontSize: 14, color: '#5D4037' },
  emptyCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151' },
  emptySub: { fontSize: 13, color: '#8D6E63', textAlign: 'center', lineHeight: 18 },
  farmCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  farmHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  farmIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E8F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  farmName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  farmAddr: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  entityChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#E8F5EE',
  },
  entityChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0A5C36',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  farmMeta: { fontSize: 12, color: colors.tertiary, marginTop: 2 },
  parcelList: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  noParcelText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
  parcelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 8,
  },
  parcelNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  parcelCode: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5 },
  parcelName: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 },
  parcelMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parcelStatusBadge: {
    fontSize: 11,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  parcelArea: { fontSize: 12, color: '#6B7280' },
  parcelActions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 },
  iconBtn: { padding: 6, borderRadius: 6 },
  modalContainer: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20 },
  modalTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#0A5C36' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  entitySegmentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  entitySegmentBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
  },
  entitySegmentBtnActive: { borderColor: '#0A5C36', backgroundColor: '#ECFDF5' },
  entitySegmentText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  entitySegmentTextActive: { color: '#0A5C36', fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 32 },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#0A5C36',
    alignItems: 'center',
  },
  modalSaveBtnDisabled: { backgroundColor: '#9CA3AF' },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
