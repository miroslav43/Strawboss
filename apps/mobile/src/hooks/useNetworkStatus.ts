import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Hook to monitor network connectivity.
 * Returns current connection status that updates in real-time.
 */
export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? false);
    });
    return unsubscribe;
  }, []);

  return { isConnected };
}
