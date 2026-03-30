import { Tabs } from 'expo-router';
import { Text, StyleSheet } from 'react-native';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    'Cursele Mele': '🚛',
    'Livrare': '📋',
    'Combustibil': '⛽',
  };
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[label] ?? '?'}
    </Text>
  );
}

export default function DriverTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0A5C36',
        tabBarInactiveTintColor: '#8D6E63',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#D7CCC8',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Cursele Mele',
          tabBarIcon: ({ focused }) => <TabIcon label="Cursele Mele" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="delivery"
        options={{
          title: 'Livrare',
          tabBarIcon: ({ focused }) => <TabIcon label="Livrare" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="fuel"
        options={{
          title: 'Combustibil',
          tabBarIcon: ({ focused }) => <TabIcon label="Combustibil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 22,
  },
  iconFocused: {
    opacity: 1,
  },
});
