import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scale } from '@/utils/responsive';
import { SyncQueueBanner } from './SyncQueueBanner';

/**
 * Positions the {@link SyncQueueBanner} just above the role tab bar.
 * `box-none` lets touches pass through the empty area while the banner
 * itself (when visible) still handles taps.
 */
export function SyncQueueBannerHost() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = scale(60) + Math.max(12, insets.bottom);

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: tabBarHeight }}
    >
      <SyncQueueBanner />
    </View>
  );
}
