import { View, Text, StyleSheet } from 'react-native';
import { PhotoCapture } from '../../shared/PhotoCapture';
import { colors } from '@strawboss/ui-tokens';

interface WeightTicketPhotoProps {
  onCapture: (uri: string) => void;
}

export function WeightTicketPhoto({ onCapture }: WeightTicketPhotoProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Weight Ticket Photo</Text>
      <Text style={styles.subtitle}>Take a photo of the weight ticket</Text>
      <PhotoCapture onCapture={onCapture} label="Weight Ticket" />
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
});
