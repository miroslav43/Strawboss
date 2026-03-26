import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

/**
 * Loading flow screen - placeholder for Task 14.
 * Will handle: bale scanning, loader assignment, loading confirmation.
 */
export default function LoadScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Loading' }} />
      <View style={styles.content}>
        <Text style={styles.title}>Loading Operation</Text>
        <Text style={styles.placeholder}>
          This screen will be implemented in Task 14.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3DED8',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0A5C36',
    marginBottom: 12,
  },
  placeholder: {
    fontSize: 14,
    color: '#8D6E63',
    textAlign: 'center',
  },
});
