import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Hook to monitor network connectivity.
 * Returns current connection status that updates in real-time.
 *
 * Initialised as `null` (M33) so consumers can distinguish "not yet known"
 * from "definitely online/offline" and avoid triggering sync before the
 * first real NetInfo event arrives.
 */
export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? false);
    });
    return unsubscribe;
  }, []);

  return { isConnected };
}
