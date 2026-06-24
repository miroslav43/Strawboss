/**
 * T6 exit / T9.10 — Partial vs Total picker shown on the production-entry
 * screen after the baler exits a parcel geofence.
 *
 * Two big stacked buttons so the choice is unambiguous and easy to tap with
 * gloves. The selected button gets a thicker border + filled background.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useI18n } from '@/lib/i18n';

export type HarvestFinishValue = 'partial' | 'total';

export interface HarvestFinishPickerProps {
  value: HarvestFinishValue | null;
  onChange: (v: HarvestFinishValue) => void;
}

interface OptionConfig {
  value: HarvestFinishValue;
  labelKey: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
}

const OPTIONS: OptionConfig[] = [
  {
    value: 'partial',
    labelKey: 'production.harvestFinish.partial',
    icon: 'progress-clock',
    color: '#EA580C',
  },
  {
    value: 'total',
    labelKey: 'production.harvestFinish.total',
    icon: 'check-circle',
    color: '#0A5C36',
  },
];

export function HarvestFinishPicker({ value, onChange }: HarvestFinishPickerProps) {
  const { t } = useI18n();
  const handlePick = (next: HarvestFinishValue) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onChange(next);
  };

  return (
    <View style={styles.container}>
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => handlePick(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={t(opt.labelKey)}
            style={[
              styles.option,
              {
                borderColor: opt.color,
                backgroundColor: selected ? opt.color : '#FFFFFF',
                borderWidth: selected ? 3 : 1.5,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={opt.icon}
              size={28}
              color={selected ? '#FFFFFF' : opt.color}
            />
            <Text
              numberOfLines={1}
              style={[styles.label, { color: selected ? '#FFFFFF' : opt.color }]}
            >
              {t(opt.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, width: '100%' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  label: { flex: 1, flexShrink: 1, fontSize: 17, fontWeight: '700' },
});
