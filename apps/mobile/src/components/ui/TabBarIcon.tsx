import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';

interface TabBarIconProps {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  focused: boolean;
  color: string;
  size: number;
}

export function TabBarIcon({ name, focused, color, size }: TabBarIconProps) {
  return (
    <View style={[styles.pill, focused && styles.pillFocused]}>
      <MaterialCommunityIcons name={name} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: 48,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  pillFocused: {
    backgroundColor: colors.primary50,
  },
});
