import { Tabs } from 'expo-router';
import { Text, StyleSheet } from 'react-native';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    'Scanează': '📷',
    'Încărcări': '📦',
    'Consumabile': '⛽',
    'Profil': '👤',
  };
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[label] ?? '?'}
    </Text>
  );
}

export default function LoaderTabLayout() {
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
          title: 'Scanează',
          tabBarIcon: ({ focused }) => <TabIcon label="Scanează" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="bales"
        options={{
          title: 'Încărcări',
          tabBarIcon: ({ focused }) => <TabIcon label="Încărcări" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="consumables"
        options={{
          title: 'Consumabile',
          tabBarIcon: ({ focused }) => <TabIcon label="Consumabile" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon label="Profil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 22 },
  iconFocused: { opacity: 1 },
});
