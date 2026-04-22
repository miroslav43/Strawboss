import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useState, useCallback } from 'react';
import { colors } from '@strawboss/ui-tokens';
import type { ActiveParcel } from '@/hooks/useActiveParcels';

export interface ParcelSelectorProps {
  onSelect: (parcelId: string, parcelName: string) => void;
  selectedId: string | null;
  selectedName: string | null;
  /** From parent `useActiveParcels()` — avoids a second useQuery in this component. */
  parcels: ActiveParcel[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /**
   * When false, only the modal is rendered; control visibility with
   * `modalOpen` + `onModalOpenChange` (controlled) or omit for fully controlled from parent.
   */
  showTrigger?: boolean;
  /** Controlled modal visibility (required together with onModalOpenChange when showTrigger is false). */
  modalOpen?: boolean;
  onModalOpenChange?: (open: boolean) => void;
}

export function ParcelSelector({
  onSelect,
  selectedId,
  selectedName,
  parcels,
  isLoading,
  isError,
  showTrigger = true,
  modalOpen: modalOpenProp,
  onModalOpenChange,
}: ParcelSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = modalOpenProp !== undefined;
  const modalVisible = isControlled ? modalOpenProp : internalOpen;

  const setModalVisible = useCallback(
    (open: boolean) => {
      onModalOpenChange?.(open);
      if (!isControlled) setInternalOpen(open);
    },
    [isControlled, onModalOpenChange],
  );

  const handleSelect = (parcel: ActiveParcel) => {
    onSelect(parcel.id, parcel.name);
    setModalVisible(false);
  };

  return (
    <View>
      {showTrigger && (
        <TouchableOpacity
          style={styles.selector}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text
              style={[
                styles.selectorText,
                !selectedId && styles.selectorPlaceholder,
              ]}
            >
              {selectedName ?? 'Selectează parcela...'}
            </Text>
          )}
          <Text style={styles.chevron}>{'›'}</Text>
        </TouchableOpacity>
      )}

      {showTrigger && isError && (
        <Text style={styles.errorText}>
          Eroare la încărcarea parcelelor. Încearcă din nou.
        </Text>
      )}

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selectează parcela</Text>
            {isLoading ? (
              <ActivityIndicator
                style={{ marginVertical: 24 }}
                color={colors.primary}
              />
            ) : isError ? (
              <Text style={styles.errorTextCenter}>
                Eroare la încărcarea parcelelor.
              </Text>
            ) : (
              <ScrollView style={styles.scrollView}>
                {(parcels ?? []).map((parcel) => (
                  <TouchableOpacity
                    key={parcel.id}
                    style={[
                      styles.parcelItem,
                      selectedId === parcel.id && styles.parcelItemSelected,
                    ]}
                    onPress={() => handleSelect(parcel)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.parcelName,
                        selectedId === parcel.id && styles.parcelNameSelected,
                      ]}
                    >
                      {parcel.code ? `${parcel.name} (${parcel.code})` : parcel.name}
                    </Text>
                    {selectedId === parcel.id && (
                      <Text style={styles.checkmark}>{'\u2713'}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setModalVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Anulează</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral100,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  selectorText: {
    flex: 1,
    fontSize: 16,
    color: colors.black,
    fontWeight: '500',
  },
  selectorPlaceholder: {
    color: colors.neutral400,
    fontWeight: '400',
  },
  chevron: {
    fontSize: 20,
    color: colors.neutral400,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 6,
    fontSize: 13,
    color: colors.danger,
  },
  errorTextCenter: {
    textAlign: 'center',
    marginVertical: 24,
    paddingHorizontal: 20,
    fontSize: 14,
    color: colors.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.black,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  scrollView: {
    paddingHorizontal: 20,
  },
  parcelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  parcelItemSelected: {
    backgroundColor: colors.primary50,
  },
  parcelName: {
    flex: 1,
    fontSize: 16,
    color: colors.black,
  },
  parcelNameSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '700',
  },
  cancelButton: {
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.neutral100,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral,
  },
});
