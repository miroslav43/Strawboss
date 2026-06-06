import { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Farm } from '@strawboss/types';
import { FarmEntityType, CropType } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';

type ModalView = 'form' | 'pick_farm' | 'create_farm' | 'pick_crop';

const CROP_LABELS: Record<CropType, string> = {
  [CropType.grau]: 'Grâu',
  [CropType.orz]: 'Orz',
  [CropType.rapita]: 'Rapiță',
  [CropType.plante_nutret]: 'Plante de nutreț',
  [CropType.altele]: 'Altele',
};

const CROP_OPTIONS: CropType[] = [
  CropType.grau,
  CropType.orz,
  CropType.rapita,
  CropType.plante_nutret,
  CropType.altele,
];

interface Props {
  visible: boolean;
  onSave: (data: {
    name: string;
    farmId: string | null;
    municipality: string;
    notes: string;
    cropType: CropType | null;
  }) => void;
  onClose: () => void;
  isSaving: boolean;
}

export function CreateParcelModal({ visible, onSave, onClose, isSaving }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Navigation between views inside one Modal
  const [view, setView] = useState<ModalView>('form');

  // Form fields
  const [name, setName] = useState('');
  const [farmId, setFarmId] = useState<string | null>(null);
  const [farmName, setFarmName] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [notes, setNotes] = useState('');
  const [cropType, setCropType] = useState<CropType | null>(null);
  const [error, setError] = useState('');

  // Inline create-farm fields
  const [newFarmName, setNewFarmName] = useState('');
  const [newFarmPhone, setNewFarmPhone] = useState('');
  const [newFarmEntityType, setNewFarmEntityType] = useState<FarmEntityType | ''>('');
  const [newFarmCui, setNewFarmCui] = useState('');
  const [newFarmApia, setNewFarmApia] = useState('');
  const [newFarmAddress, setNewFarmAddress] = useState('');
  const [creatingFarm, setCreatingFarm] = useState(false);
  const [createFarmError, setCreateFarmError] = useState('');

  const { data: farms = [] } = useQuery({
    queryKey: ['farms'],
    queryFn: () => mobileApiClient.get<Farm[]>('/api/v1/farms'),
    staleTime: 5 * 60_000,
  });

  function resetAll() {
    setView('form');
    setName('');
    setFarmId(null);
    setFarmName('');
    setMunicipality('');
    setNotes('');
    setCropType(null);
    setError('');
    setNewFarmName('');
    setNewFarmPhone('');
    setNewFarmEntityType('');
    setNewFarmCui('');
    setNewFarmApia('');
    setNewFarmAddress('');
    setCreateFarmError('');
  }

  function handleClose() {
    resetAll();
    onClose();
  }

  function handleSave() {
    if (!name.trim()) {
      setError('Numele câmpului este obligatoriu.');
      return;
    }
    setError('');
    onSave({
      name: name.trim(),
      farmId,
      municipality: municipality.trim(),
      notes: notes.trim(),
      cropType,
    });
    resetAll();
  }

  function selectFarm(farm: Farm) {
    setFarmId(farm.id);
    setFarmName(farm.name);
    setView('form');
  }

  function clearFarm() {
    setFarmId(null);
    setFarmName('');
  }

  const handleCreateFarm = useCallback(async () => {
    if (!newFarmName.trim()) {
      setCreateFarmError('Numele fermei este obligatoriu.');
      return;
    }
    if (!newFarmPhone.trim()) {
      setCreateFarmError('Numărul de telefon este obligatoriu.');
      return;
    }
    setCreateFarmError('');
    setCreatingFarm(true);
    try {
      const created = await mobileApiClient.post<Farm>('/api/v1/farms', {
        name: newFarmName.trim(),
        phone: newFarmPhone.trim(),
        entityType: newFarmEntityType || undefined,
        cui: newFarmCui.trim() || undefined,
        apiaCode: newFarmApia.trim() || undefined,
        address: newFarmAddress.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['farms'] });
      setFarmId(created.id);
      setFarmName(created.name);
      setNewFarmName('');
      setNewFarmPhone('');
      setNewFarmEntityType('');
      setNewFarmCui('');
      setNewFarmApia('');
      setNewFarmAddress('');
      setView('form');
    } catch {
      setCreateFarmError('Nu s-a putut crea ferma. Încearcă din nou.');
    } finally {
      setCreatingFarm(false);
    }
  }, [
    newFarmName,
    newFarmPhone,
    newFarmEntityType,
    newFarmCui,
    newFarmApia,
    newFarmAddress,
    queryClient,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8 },
          ]}
        >
          {/* ── VIEW: form ─────────────────────────────────────────────── */}
          {view === 'form' && (
            <>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Câmp nou</Text>
                <TouchableOpacity onPress={handleClose} hitSlop={12}>
                  <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Name */}
                <Text style={styles.label}>
                  Nume câmp <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="ex. Câmp Nord 12"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                  autoFocus
                />

                {/* Farm picker field */}
                <Text style={styles.label}>Fermă</Text>
                <TouchableOpacity style={styles.pickerField} onPress={() => setView('pick_farm')}>
                  <Text style={farmId ? styles.pickerValue : styles.pickerPlaceholder}>
                    {farmId ? farmName : 'Selectează ferma (opțional)'}
                  </Text>
                  <View style={styles.pickerRight}>
                    {farmId ? (
                      <TouchableOpacity onPress={clearFarm} hitSlop={8}>
                        <MaterialCommunityIcons name="close-circle" size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    ) : null}
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#6B7280" />
                  </View>
                </TouchableOpacity>

                {/* Crop picker field */}
                <Text style={styles.label}>Cultură</Text>
                <TouchableOpacity style={styles.pickerField} onPress={() => setView('pick_crop')}>
                  <Text style={cropType ? styles.pickerValue : styles.pickerPlaceholder}>
                    {cropType ? CROP_LABELS[cropType] : 'Selectează cultura (opțional)'}
                  </Text>
                  <View style={styles.pickerRight}>
                    {cropType ? (
                      <TouchableOpacity onPress={() => setCropType(null)} hitSlop={8}>
                        <MaterialCommunityIcons name="close-circle" size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    ) : null}
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#6B7280" />
                  </View>
                </TouchableOpacity>

                {/* Municipality */}
                <Text style={styles.label}>Localitate</Text>
                <TextInput
                  style={styles.input}
                  value={municipality}
                  onChangeText={setMunicipality}
                  placeholder="Auto-detectat din locație"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                />

                {/* Notes */}
                <Text style={styles.label}>Note</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Observații suplimentare (opțional)"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={handleClose}
                  disabled={isSaving}
                >
                  <Text style={styles.cancelBtnText}>Anulează</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Salvează câmpul</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── VIEW: pick_farm ────────────────────────────────────────── */}
          {view === 'pick_farm' && (
            <>
              <View style={styles.titleRow}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setView('form')}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#0A5C36" />
                  <Text style={styles.backBtnText}>Înapoi</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Selectează ferma</Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {farms.length === 0 ? (
                  <Text style={styles.emptyText}>Nicio fermă creată încă.</Text>
                ) : (
                  farms.map((farm) => (
                    <TouchableOpacity
                      key={farm.id}
                      style={[styles.farmItem, farm.id === farmId && styles.farmItemSelected]}
                      onPress={() => selectFarm(farm)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.farmItemName}>{farm.name}</Text>
                        {farm.address ? (
                          <Text style={styles.farmItemSub}>{farm.address}</Text>
                        ) : null}
                        {farm.phone ? <Text style={styles.farmItemSub}>{farm.phone}</Text> : null}
                      </View>
                      {farm.id === farmId && (
                        <MaterialCommunityIcons name="check" size={20} color="#0A5C36" />
                      )}
                    </TouchableOpacity>
                  ))
                )}

                {/* Add new farm option */}
                <TouchableOpacity style={styles.addFarmBtn} onPress={() => setView('create_farm')}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={20} color="#0A5C36" />
                  <Text style={styles.addFarmBtnText}>Adaugă fermă nouă</Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          )}

          {/* ── VIEW: pick_crop ────────────────────────────────────────── */}
          {view === 'pick_crop' && (
            <>
              <View style={styles.titleRow}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setView('form')}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#0A5C36" />
                  <Text style={styles.backBtnText}>Înapoi</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Selectează cultura</Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {CROP_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.farmItem, option === cropType && styles.farmItemSelected]}
                    onPress={() => {
                      setCropType(option);
                      setView('form');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.farmItemName, { flex: 1 }]}>{CROP_LABELS[option]}</Text>
                    {option === cropType && (
                      <MaterialCommunityIcons name="check" size={20} color="#0A5C36" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* ── VIEW: create_farm ──────────────────────────────────────── */}
          {view === 'create_farm' && (
            <>
              <View style={styles.titleRow}>
                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={() => setView('pick_farm')}
                  hitSlop={8}
                >
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#0A5C36" />
                  <Text style={styles.backBtnText}>Înapoi</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Fermă nouă</Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.label}>
                  Nume fermă <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={newFarmName}
                  onChangeText={setNewFarmName}
                  placeholder="ex. Ferma Ionescu"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                  autoFocus
                />

                <Text style={styles.label}>
                  Telefon <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={newFarmPhone}
                  onChangeText={setNewFarmPhone}
                  placeholder="ex. 0722 123 456"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Tip entitate</Text>
                <View style={styles.segmentRow}>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      newFarmEntityType === FarmEntityType.persoana_juridica &&
                        styles.segmentBtnActive,
                    ]}
                    onPress={() =>
                      setNewFarmEntityType(
                        newFarmEntityType === FarmEntityType.persoana_juridica
                          ? ''
                          : FarmEntityType.persoana_juridica,
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        newFarmEntityType === FarmEntityType.persoana_juridica &&
                          styles.segmentTextActive,
                      ]}
                    >
                      Persoană juridică
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.segmentBtn,
                      newFarmEntityType === FarmEntityType.persoana_fizica &&
                        styles.segmentBtnActive,
                    ]}
                    onPress={() =>
                      setNewFarmEntityType(
                        newFarmEntityType === FarmEntityType.persoana_fizica
                          ? ''
                          : FarmEntityType.persoana_fizica,
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        newFarmEntityType === FarmEntityType.persoana_fizica &&
                          styles.segmentTextActive,
                      ]}
                    >
                      Persoană fizică
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>CUI</Text>
                <TextInput
                  style={styles.input}
                  value={newFarmCui}
                  onChangeText={setNewFarmCui}
                  placeholder="ex. RO12345678 (opțional)"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="characters"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Cod RO APIA</Text>
                <TextInput
                  style={styles.input}
                  value={newFarmApia}
                  onChangeText={setNewFarmApia}
                  placeholder="Cod APIA al fermei (opțional)"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Adresă</Text>
                <TextInput
                  style={styles.input}
                  value={newFarmAddress}
                  onChangeText={setNewFarmAddress}
                  placeholder="ex. Deta, Timiș (opțional)"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="done"
                />

                {createFarmError ? <Text style={styles.errorText}>{createFarmError}</Text> : null}
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setView('pick_farm')}
                  disabled={creatingFarm}
                >
                  <Text style={styles.cancelBtnText}>Renunță</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, creatingFarm && styles.saveBtnDisabled]}
                  onPress={handleCreateFarm}
                  disabled={creatingFarm}
                >
                  {creatingFarm ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Creează ferma</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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
  title: { fontSize: 20, fontWeight: '700', color: '#0A5C36', flex: 1, textAlign: 'center' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backBtnText: { fontSize: 14, fontWeight: '600', color: '#0A5C36' },
  form: { gap: 4, paddingBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
  required: { color: '#DC2626' },
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
  inputMultiline: { height: 88, paddingTop: 12 },
  pickerField: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FAFAFA',
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerValue: { flex: 1, fontSize: 15, color: '#111827' },
  pickerPlaceholder: { flex: 1, fontSize: 15, color: '#9CA3AF' },
  pickerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  segmentBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
  },
  segmentBtnActive: { borderColor: '#0A5C36', backgroundColor: '#ECFDF5' },
  segmentText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  segmentTextActive: { color: '#0A5C36', fontWeight: '700' },
  errorText: { color: '#DC2626', fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  saveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#0A5C36',
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#9CA3AF' },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  farmItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 8,
  },
  farmItemSelected: { backgroundColor: '#F0FDF4' },
  farmItemName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  farmItemSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  emptyText: { textAlign: 'center', color: '#9CA3AF', fontSize: 14, paddingVertical: 32 },
  addFarmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  addFarmBtnText: { fontSize: 15, fontWeight: '600', color: '#0A5C36' },
});
