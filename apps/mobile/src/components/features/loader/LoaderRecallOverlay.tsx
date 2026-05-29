import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BigButton } from '@/components/ui/BigButton';
import type { LoaderRecallPromptState } from '@/hooks/useLoaderRecallPrompt';

interface LoaderRecallOverlayProps {
  prompt: LoaderRecallPromptState | null;
  pending: boolean;
  onRespond: (recall: boolean) => void;
}

/**
 * Plan C (#14) — blocking prompt shown to the loader after a truck unloads,
 * asking whether to recall the truck for another iteration on the same parcel.
 *
 * - DA  → POST loader-recall-response { recall: true }  → backend mints the
 *         next iteration and pushes the driver.
 * - NU  → POST loader-recall-response { recall: false } → backend records the
 *         decline and (if the truck is idle) alerts admins immediately.
 *
 * Driven by `useLoaderRecallPrompt`; mounted in `(loader)/_layout.tsx` next to
 * `GeofenceOverlay`. Mirrors the bottom-sheet modal pattern of GeofenceOverlay.
 */
export function LoaderRecallOverlay({ prompt, pending, onRespond }: LoaderRecallOverlayProps) {
  if (!prompt) return null;

  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modalContent}>
        <View style={styles.modalHandle} />

        <MaterialCommunityIcons name="truck-check" size={48} color="#0A5C36" />
        <Text style={styles.modalTitle}>
          Camion descărcat{'\n'}
          <Text style={styles.modalTruckCode}>{prompt.truckCode}</Text>
        </Text>
        <Text style={styles.modalSubtitle}>Îl chemi înapoi pentru încă o cursă?</Text>

        <View style={styles.modalActions}>
          <BigButton
            title="Da, cheamă-l înapoi"
            onPress={() => onRespond(true)}
            loading={pending}
          />
          <BigButton
            title="Nu"
            variant="outline"
            onPress={() => onRespond(false)}
            disabled={pending}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    // 9998 < GeofenceOverlay's 9999 so an input-requiring geofence modal
    // (exit-confirm bale count) is never covered by the recall prompt.
    zIndex: 9998,
  },
  modalContent: {
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 16,
    alignItems: 'center',
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7CCC8',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0A5C36',
    textAlign: 'center',
    lineHeight: 30,
  },
  modalTruckCode: {
    color: '#B7791F',
  },
  modalSubtitle: {
    fontSize: 15,
    color: '#5D4037',
    textAlign: 'center',
  },
  modalActions: {
    gap: 10,
    width: '100%',
    marginTop: 8,
  },
});
