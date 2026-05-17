import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface OcrHintProps {
  /** Human-readable value read from the photo, e.g. "45.2 L". */
  value: string;
}

/** Small inline banner shown above a numeric field pre-filled from OCR. */
export function OcrHint({ value }: OcrHintProps) {
  return (
    <View style={styles.hint}>
      <MaterialCommunityIcons name="text-recognition" size={16} color="#B7791F" />
      <Text style={styles.text}>
        Citit din poză: <Text style={styles.value}>{value}</Text> — verifică
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
  },
  value: {
    fontWeight: '700',
  },
});
