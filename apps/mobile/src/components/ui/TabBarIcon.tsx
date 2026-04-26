import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';
import { scale } from '@/utils/responsive';

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

const PILL_WIDTH = scale(48);
const PILL_HEIGHT = scale(30);
const PILL_RADIUS = scale(15);

const styles = StyleSheet.create({
  pill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  pillFocused: {
    backgroundColor: colors.primary50,
  },
});
