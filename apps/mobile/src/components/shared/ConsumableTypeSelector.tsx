import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

type ConsumableType = 'diesel' | 'twine';

interface ConsumableTypeSelectorProps {
  onSelect: (type: ConsumableType) => void;
  selected: ConsumableType | null;
}

interface CardConfig {
  type: ConsumableType;
  icon: string;
  label: string;
}

const CARDS: readonly CardConfig[] = [
  { type: 'diesel', icon: '⛽', label: 'Motorină' },
  { type: 'twine', icon: '🧵', label: 'Sfoară' },
] as const;

export function ConsumableTypeSelector({
  onSelect,
  selected,
}: ConsumableTypeSelectorProps) {
  return (
    <View style={styles.container}>
      {CARDS.map((card) => (
        <TouchableOpacity
          key={card.type}
          style={[
            styles.card,
            selected === card.type ? styles.cardSelected : styles.cardUnselected,
          ]}
          onPress={() => onSelect(card.type)}
          activeOpacity={0.7}
        >
          <Text style={styles.icon}>{card.icon}</Text>
          <Text
            style={[
              styles.label,
              selected === card.type && styles.labelSelected,
            ]}
          >
            {card.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: colors.white,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  cardUnselected: {
    borderColor: colors.neutral100,
  },
  icon: {
    fontSize: 40,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.black,
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.primary,
  },
});
