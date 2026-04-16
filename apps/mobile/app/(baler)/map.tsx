import { useLocalSearchParams } from 'expo-router';
import { MapScreen } from '@/components/map/MapScreen';

export default function BalerMapScreen() {
  const { focusId } = useLocalSearchParams<{ focusId?: string }>();
  return <MapScreen focusId={focusId} />;
}
