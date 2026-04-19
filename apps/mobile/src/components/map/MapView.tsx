import { useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { MapCommand, MapEvent } from '@/map/map-bridge';
import { serializeCommand, parseEvent } from '@/map/map-bridge';
import { LEAFLET_MAP_HTML } from '@/map/leaflet-map-content';

export interface MapViewHandle {
  sendCommand(cmd: MapCommand): void;
}

interface MapViewProps {
  onEvent?: (event: MapEvent) => void;
  onReady?: () => void;
  style?: object;
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(
  function MapView({ onEvent, onReady, style }, ref) {
    const webViewRef = useRef<WebView>(null);
    const [loading, setLoading] = useState(true);

    useImperativeHandle(ref, () => ({
      sendCommand(cmd: MapCommand) {
        webViewRef.current?.injectJavaScript(serializeCommand(cmd));
      },
    }));

    const handleMessage = useCallback(
      (e: WebViewMessageEvent) => {
        const event = parseEvent(e.nativeEvent.data);
        if (!event) return;

        if (event.type === 'MAP_READY') {
          setLoading(false);
          onReady?.();
        }
        onEvent?.(event);
      },
      [onEvent, onReady],
    );

    return (
      <View style={[styles.container, style]}>
        <WebView
          ref={webViewRef}
          // Inline HTML + HTTPS baseUrl avoids Metro's synthetic http:// asset
          // URL that Android 9+ blocks as cleartext.
          source={{ html: LEAFLET_MAP_HTML, baseUrl: 'https://localhost/' }}
          style={styles.webview}
          javaScriptEnabled
          originWhitelist={['*']}
          onMessage={handleMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          startInLoadingState={false}
          mixedContentMode="never"
          onError={() => setLoading(false)}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#0A5C36" size="large" />
            <Text style={styles.loadingText}>Se încarcă harta...</Text>
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F3DED8',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { fontSize: 14, color: '#5D4037' },
});
