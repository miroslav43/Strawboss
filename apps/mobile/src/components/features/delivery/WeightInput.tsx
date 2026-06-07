import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NumericPad } from '../../ui/NumericPad';
import { BigButton } from '../../ui/BigButton';
import { colors } from '@strawboss/ui-tokens';

interface WeightInputProps {
  /** Loaded-truck (gross) weight, kg, as a string. */
  grossValue: string;
  onGrossChange: (value: string) => void;
  /** Empty-truck (tare) weight, kg, as a string. */
  tareValue: string;
  onTareChange: (value: string) => void;
  onConfirm: () => void;
}

type ActiveField = 'gross' | 'tare';

/**
 * Two-weight capture at the depot: gross (loaded truck) and tare (empty truck).
 * Net = gross - tare is computed live. One numeric pad edits the selected field.
 */
export function WeightInput({
  grossValue,
  onGrossChange,
  tareValue,
  onTareChange,
  onConfirm,
}: WeightInputProps) {
  const [active, setActive] = useState<ActiveField>('gross');

  const gross = parseFloat(grossValue) || 0;
  const tare = parseFloat(tareValue) || 0;
  const net = gross - tare;

  const grossOk = grossValue.length > 0 && gross > 0;
  const tareOk = tareValue.length > 0 && tare >= 0;
  const tareNotOverGross = tare <= gross;
  const isValid = grossOk && tareOk && tareNotOverGross && net > 0;

  const activeValue = active === 'gross' ? grossValue : tareValue;
  const onActiveChange = active === 'gross' ? onGrossChange : onTareChange;

  return (
    <View style={styles.container}>
      <View style={styles.fieldsRow}>
        <TouchableOpacity
          style={[styles.field, active === 'gross' && styles.fieldActive]}
          activeOpacity={0.8}
          onPress={() => setActive('gross')}
        >
          <Text style={styles.fieldLabel}>Brut (cântărit)</Text>
          <Text style={styles.fieldValue}>{grossValue || '0'} kg</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.field, active === 'tare' && styles.fieldActive]}
          activeOpacity={0.8}
          onPress={() => setActive('tare')}
        >
          <Text style={styles.fieldLabel}>Tară (camion gol)</Text>
          <Text style={styles.fieldValue}>{tareValue || '0'} kg</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.netRow}>
        <Text style={styles.netLabel}>Net</Text>
        <Text style={[styles.netValue, net <= 0 && styles.netInvalid]}>
          {net > 0 ? `${net} kg` : '—'}
        </Text>
      </View>
      {!tareNotOverGross && tareValue.length > 0 ? (
        <Text style={styles.errorText}>Tara nu poate fi mai mare decât greutatea brută.</Text>
      ) : null}

      <Text style={styles.editingHint}>Editezi: {active === 'gross' ? 'Brut' : 'Tară'}</Text>
      <NumericPad value={activeValue} onChange={onActiveChange} maxLength={8} decimal />

      <View style={styles.buttonContainer}>
        <BigButton title="Continuă" onPress={onConfirm} disabled={!isValid} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  fieldsRow: { flexDirection: 'row', gap: 10 },
  field: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    gap: 4,
  },
  fieldActive: { borderColor: colors.primary, backgroundColor: '#F9FFF9' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral, textAlign: 'center' },
  fieldValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  netLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral },
  netValue: { fontSize: 20, fontWeight: '800', color: '#0A5C36' },
  netInvalid: { color: '#9CA3AF' },
  errorText: { fontSize: 13, color: '#C62828', textAlign: 'center' },
  editingHint: { fontSize: 12, color: colors.neutral, textAlign: 'center', marginTop: 4 },
  buttonContainer: { width: '100%', marginTop: 8 },
});
