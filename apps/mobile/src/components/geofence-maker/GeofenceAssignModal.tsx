import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Parcel } from '@strawboss/types';

interface DeliveryDestination {
  id: string;
  name: string;
  code: string;
}

interface Props {
  visible: boolean;
  parcels: Parcel[];
  deposits: DeliveryDestination[];
  onSave: (type: 'parcel' | 'deposit', entityId: string) => void;
  onClose: () => void;
  isSaving: boolean;
}

export function GeofenceAssignModal({ visible, parcels, deposits, onSave, onClose, isSaving }: Props) {
  const insets = useSafeAreaInsets();
  const [entityType, setEntityType] = useState<'parcel' | 'deposit'>('parcel');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = entityType === 'parcel'
    ? parcels.map((p) => ({ id: p.id, label: p.name ?? p.code, sub: p.code }))
    : deposits.map((d) => ({ id: d.id, label: d.name, sub: d.code }));

  function handleTypeToggle(type: 'parcel' | 'deposit') {
    setEntityType(type);
    setSelectedId(null);
  }

  function handleSave() {
    if (!selectedId) return;
    onSave(entityType, selectedId);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.header}>Atribuie zona desenată</Text>

        {/* Type toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, entityType === 'parcel' && styles.toggleBtnActive]}
            onPress={() => handleTypeToggle('parcel')}
          >
            <Text style={[styles.toggleBtnText, entityType === 'parcel' && styles.toggleBtnTextActive]}>
              Teren
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, entityType === 'deposit' && styles.toggleBtnActive]}
            onPress={() => handleTypeToggle('deposit')}
          >
            <Text style={[styles.toggleBtnText, entityType === 'deposit' && styles.toggleBtnTextActive]}>
              Depozit
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.listHint}>
          {entityType === 'parcel' ? 'Selectează terenul:' : 'Selectează depozitul:'}
        </Text>

        {/* Entity list */}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.listItem, item.id === selectedId && styles.listItemSelected]}
              onPress={() => setSelectedId(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.listItemInner}>
                <View style={[styles.radio, item.id === selectedId && styles.radioSelected]}>
                  {item.id === selectedId && <View style={styles.radioDot} />}
                </View>
                <View style={styles.listItemText}>
                  <Text style={styles.listItemLabel}>{item.label}</Text>
                  {item.sub !== item.label && (
                    <Text style={styles.listItemSub}>{item.sub}</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {entityType === 'parcel' ? 'Niciun teren disponibil.' : 'Niciun depozit disponibil.'}
            </Text>
          }
        />

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isSaving}>
            <Text style={styles.cancelBtnText}>Anulează</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, (!selectedId || isSaving) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!selectedId || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Salvează</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
  },
  header: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0A5C36',
    textAlign: 'center',
    marginBottom: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#14b8a6',
    overflow: 'hidden',
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  toggleBtnActive: {
    backgroundColor: '#14b8a6',
  },
  toggleBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#14b8a6',
  },
  toggleBtnTextActive: {
    color: '#fff',
  },
  listHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  list: {
    flex: 1,
    marginBottom: 16,
  },
  listItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#FAFAFA',
  },
  listItemSelected: {
    borderColor: '#14b8a6',
    backgroundColor: '#F0FDFA',
  },
  listItemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: '#14b8a6',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#14b8a6',
  },
  listItemText: {
    flex: 1,
  },
  listItemLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  listItemSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    paddingVertical: 24,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#0A5C36',
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
