import { View, Text, StyleSheet } from 'react-native';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface WeightTicketPhotoProps {
  onCapture: (uri: string) => void;
  /** Proceed without a photo — the weigh-ticket photo is optional server-side. */
  onSkip: () => void;
}

export function WeightTicketPhoto({ onCapture, onSkip }: WeightTicketPhotoProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bon de cântar</Text>
      <Text style={styles.subtitle}>Fotografiază bonul de cântar (opțional)</Text>
      <PhotoCapture onCapture={onCapture} label="Bon de cântar" />
      <View style={styles.skip}>
        <BigButton title="Continuă fără poză" variant="outline" onPress={onSkip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.neutral,
    textAlign: 'center',
  },
  skip: {
    marginTop: 'auto',
  },
});
