import { useLocalSearchParams } from 'expo-router';
import { MapScreen } from '@/components/map/MapScreen';

export default function DriverMapScreen() {
  const { focusId } = useLocalSearchParams<{ focusId?: string }>();
  return <MapScreen focusId={focusId} />;
}
